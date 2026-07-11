//! Agent loop: історія повідомлень, ітерація tool calls, event-callbacks
//! (референс патерну — pi_agent_rust; спека подій — runtime.md).
//!
//! Хід (`run_turn`): user message → провайдер → поки модель просить tool
//! calls — виконати кожен через реєстр і повернути результат в історію →
//! фінальний текст. Кожен крок емітить подію `agent-protocol` через
//! callback; Envelope (seq/ts/node_hash) збирає agent-server.

use agent_protocol::Event;

use crate::provider::{
    ChatMessage, Completion, CompletionRequest, Provider, ProviderError, StreamEvent,
};
use crate::tools::{ToolOutput, ToolRegistry};

/// Стеля ітерацій tool-циклу одного ходу — захист від зациклення моделі.
pub const TOOL_ITERATION_LIMIT: usize = 16;

/// Помилка ходу агента.
#[derive(Debug)]
pub enum AgentError {
    Provider(ProviderError),
    /// Модель просить tool calls понад [`TOOL_ITERATION_LIMIT`].
    ToolLoopLimit {
        limit: usize,
    },
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentError::Provider(error) => write!(f, "{error}"),
            AgentError::ToolLoopLimit { limit } => {
                write!(f, "tool loop exceeded {limit} iterations")
            }
        }
    }
}

impl std::error::Error for AgentError {}

impl From<ProviderError> for AgentError {
    fn from(error: ProviderError) -> Self {
        AgentError::Provider(error)
    }
}

/// Агент одного run-а: провайдер + реєстр tools + історія.
pub struct Agent<P: Provider> {
    provider: P,
    tools: ToolRegistry,
    model: String,
    history: Vec<ChatMessage>,
}

impl<P: Provider> Agent<P> {
    /// `system_prompt` — протокол поведінки (`.mt/system-prompt.md`);
    /// файли вузла подаються як подальші повідомлення контексту (graph.md,
    /// «Контекст агента»).
    pub fn new(
        provider: P,
        tools: ToolRegistry,
        model: impl Into<String>,
        system_prompt: &str,
    ) -> Self {
        Self {
            provider,
            tools,
            model: model.into(),
            history: vec![ChatMessage::system(system_prompt)],
        }
    }

    pub fn history(&self) -> &[ChatMessage] {
        &self.history
    }

    /// Один хід: повертає фінальний текст асистента. Емітить
    /// `AgentTextDelta` / `ToolCall` / `ToolResult` / `AgentTextDone`.
    pub async fn run_turn(
        &mut self,
        user_text: &str,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, AgentError> {
        self.history.push(ChatMessage::user(user_text));

        for _ in 0..TOOL_ITERATION_LIMIT {
            let completion = self.complete_once(emit).await?;
            if !completion.text.is_empty() {
                self.history
                    .push(ChatMessage::assistant(completion.text.clone()));
            }
            if completion.tool_calls.is_empty() {
                emit(Event::AgentTextDone {});
                return Ok(completion.text);
            }
            for call in completion.tool_calls {
                emit(Event::ToolCall {
                    call_id: call.call_id.clone(),
                    name: call.name.clone(),
                    args: call.args.clone(),
                });
                let output = self.invoke_tool(&call.name, call.args).await;
                emit(Event::ToolResult {
                    call_id: call.call_id.clone(),
                    ok: output.ok,
                    summary: output.summary.clone(),
                });
                self.history.push(ChatMessage::tool_result(
                    call.call_id,
                    output.content.to_string(),
                ));
            }
        }

        Err(AgentError::ToolLoopLimit {
            limit: TOOL_ITERATION_LIMIT,
        })
    }

    async fn complete_once(
        &self,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<Completion, AgentError> {
        let request = CompletionRequest {
            model: self.model.clone(),
            messages: self.history.clone(),
            tools: self.tools.specs(),
        };
        let completion = self
            .provider
            .complete(request, &|stream_event| match stream_event {
                StreamEvent::TextDelta(text) => emit(Event::AgentTextDelta { text }),
            })
            .await?;
        Ok(completion)
    }

    /// Невідомий tool — не падіння ходу, а `ok: false` результат: модель
    /// бачить помилку в історії і може виправитись наступною ітерацією.
    async fn invoke_tool(&self, name: &str, args: serde_json::Value) -> ToolOutput {
        match self.tools.get(name) {
            None => ToolOutput::failure(format!("unknown tool: {name}")),
            Some(tool) => match tool.invoke(args).await {
                Ok(output) => output,
                Err(error) => ToolOutput::failure(error.to_string()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use schemars::JsonSchema;
    use serde::Deserialize;
    use serde_json::Value;

    use super::*;
    use crate::provider::{MockProvider, ToolCallRequest};
    use crate::tools::{Tool, ToolError};

    #[derive(Debug, Deserialize, JsonSchema)]
    struct EchoArgs {
        text: String,
    }

    struct EchoTool;

    #[async_trait]
    impl Tool for EchoTool {
        fn name(&self) -> &str {
            "echo"
        }

        fn description(&self) -> &str {
            "Повертає переданий текст"
        }

        fn parameters_schema(&self) -> Value {
            serde_json::to_value(schemars::schema_for!(EchoArgs)).unwrap()
        }

        async fn invoke(&self, args: Value) -> Result<ToolOutput, ToolError> {
            let args: EchoArgs = serde_json::from_value(args).map_err(|error| ToolError {
                message: error.to_string(),
            })?;
            Ok(ToolOutput::success("echo ok", Value::String(args.text)))
        }
    }

    fn registry() -> ToolRegistry {
        let mut registry = ToolRegistry::new();
        registry.register(Arc::new(EchoTool));
        registry
    }

    fn tool_call_completion() -> Completion {
        Completion {
            text: String::new(),
            tool_calls: vec![ToolCallRequest {
                call_id: "c1".into(),
                name: "echo".into(),
                args: serde_json::json!({ "text": "hi" }),
            }],
        }
    }

    fn collect_events() -> (Arc<Mutex<Vec<Event>>>, impl Fn(Event) + Send + Sync) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        (events, move |event| sink.lock().unwrap().push(event))
    }

    /// Скриптований хід: tool call → фінальний текст. Перевіряється точна
    /// послідовність подій і tool-результат в історії.
    #[tokio::test]
    async fn turn_with_tool_call_emits_expected_event_sequence() {
        let provider = MockProvider::scripted([
            tool_call_completion(),
            Completion {
                text: "done".into(),
                tool_calls: vec![],
            },
        ]);
        let mut agent = Agent::new(provider, registry(), "mock", "system");
        let (events, emit) = collect_events();

        let text = agent.run_turn("зроби echo", &emit).await.unwrap();

        assert_eq!(text, "done");
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                Event::ToolCall {
                    call_id: "c1".into(),
                    name: "echo".into(),
                    args: serde_json::json!({ "text": "hi" }),
                },
                Event::ToolResult {
                    call_id: "c1".into(),
                    ok: true,
                    summary: "echo ok".into()
                },
                Event::AgentTextDelta {
                    text: "done".into()
                },
                Event::AgentTextDone {},
            ]
        );
        // Історія: system, user, tool-результат, фінальний assistant.
        let history = agent.history();
        assert_eq!(history[2], ChatMessage::tool_result("c1", "\"hi\""));
        assert_eq!(history[3], ChatMessage::assistant("done"));
    }

    /// Невідомий tool → `ToolResult { ok: false }`, хід продовжується.
    #[tokio::test]
    async fn unknown_tool_yields_failed_result_without_crash() {
        let provider = MockProvider::scripted([
            Completion {
                text: String::new(),
                tool_calls: vec![ToolCallRequest {
                    call_id: "c1".into(),
                    name: "missing".into(),
                    args: Value::Null,
                }],
            },
            Completion {
                text: "відновився".into(),
                tool_calls: vec![],
            },
        ]);
        let mut agent = Agent::new(provider, registry(), "mock", "system");
        let (events, emit) = collect_events();

        let text = agent
            .run_turn("виклич неіснуючий tool", &emit)
            .await
            .unwrap();

        assert_eq!(text, "відновився");
        let events = events.lock().unwrap();
        assert!(events.contains(&Event::ToolResult {
            call_id: "c1".into(),
            ok: false,
            summary: "unknown tool: missing".into(),
        }));
    }

    /// Модель нескінченно просить tool calls → явна помилка ліміту.
    #[tokio::test]
    async fn endless_tool_calls_hit_iteration_limit() {
        let provider = MockProvider::scripted(
            std::iter::repeat_with(tool_call_completion).take(TOOL_ITERATION_LIMIT + 1),
        );
        let mut agent = Agent::new(provider, registry(), "mock", "system");

        let error = agent.run_turn("зациклись", &|_| {}).await.unwrap_err();

        assert!(
            matches!(error, AgentError::ToolLoopLimit { limit } if limit == TOOL_ITERATION_LIMIT)
        );
    }

    /// Провайдер бачить specs tools із реєстру в кожному запиті.
    #[tokio::test]
    async fn provider_receives_tool_specs() {
        let provider = MockProvider::scripted([Completion {
            text: "ok".into(),
            tool_calls: vec![],
        }]);
        let mut agent = Agent::new(provider, registry(), "mock", "system");
        agent.run_turn("hi", &|_| {}).await.unwrap();

        let requests = agent.provider.seen_requests.lock().unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].tools.len(), 1);
        assert_eq!(requests[0].tools[0].name, "echo");
    }
}
