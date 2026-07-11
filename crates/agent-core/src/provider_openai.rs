//! Референсний LLM-транспорт: OpenAI-compatible Chat Completions через
//! `async-openai` (спека stack.md, «LLM-провайдери»).
//!
//! `base_url` конфігурується — мінімальний спільний знаменник для omlx,
//! Ollama, LM Studio, LiteLLM; хмарні моделі — через LiteLLM-профіль.
//! SSE-парсинг робить `async-openai` (`create_stream`); руками лишається
//! тільки агрегація фрагментів tool calls за `index`. Типи SDK не
//! покидають цей модуль — назовні лише нейтральний контракт provider.rs.

use std::collections::BTreeMap;

use async_openai::config::OpenAIConfig;
use async_openai::types::chat::{
    ChatCompletionMessageToolCall, ChatCompletionMessageToolCalls,
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestMessage,
    ChatCompletionRequestSystemMessage, ChatCompletionRequestToolMessage,
    ChatCompletionRequestUserMessage, ChatCompletionTool, ChatCompletionTools,
    CreateChatCompletionRequest, CreateChatCompletionRequestArgs,
    CreateChatCompletionStreamResponse, FunctionCall, FunctionObject,
};
use async_openai::Client;
use async_trait::async_trait;
use futures::StreamExt;
use serde_json::Value;

use crate::provider::{
    ChatMessage, Completion, CompletionRequest, Provider, ProviderError, Role, StreamEvent,
    ToolCallRequest, ToolSpec,
};

/// OpenAI-compatible провайдер поверх `async-openai`.
pub struct OpenAiProvider {
    client: Client<OpenAIConfig>,
}

impl OpenAiProvider {
    /// `base_url` — корінь API (напр. `http://127.0.0.1:8080/v1`);
    /// `api_key` — порожній рядок для локальних серверів без auth.
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        let config = OpenAIConfig::new()
            .with_api_base(base_url)
            .with_api_key(api_key);
        Self {
            client: Client::with_config(config),
        }
    }
}

#[async_trait]
impl Provider for OpenAiProvider {
    async fn complete(
        &self,
        request: CompletionRequest,
        on_event: &(dyn Fn(StreamEvent) + Send + Sync),
    ) -> Result<Completion, ProviderError> {
        let openai_request = build_request(&request)?;
        let mut stream = self
            .client
            .chat()
            .create_stream(openai_request)
            .await
            .map_err(transport_error)?;
        let mut accumulator = ChunkAccumulator::default();
        while let Some(chunk) = stream.next().await {
            if let Some(delta) = accumulator.absorb(chunk.map_err(transport_error)?) {
                on_event(StreamEvent::TextDelta(delta));
            }
        }
        accumulator.finish()
    }
}

fn transport_error(error: impl std::fmt::Display) -> ProviderError {
    ProviderError::Transport(error.to_string())
}

/// Нейтральний запит → запит SDK. `stream: true` виставляє `create_stream`.
fn build_request(
    request: &CompletionRequest,
) -> Result<CreateChatCompletionRequest, ProviderError> {
    let messages = request
        .messages
        .iter()
        .map(to_openai_message)
        .collect::<Result<Vec<_>, _>>()?;
    let mut builder = CreateChatCompletionRequestArgs::default();
    builder.model(&request.model).messages(messages);
    if !request.tools.is_empty() {
        builder.tools(request.tools.iter().map(to_openai_tool).collect::<Vec<_>>());
    }
    builder.build().map_err(transport_error)
}

fn to_openai_message(message: &ChatMessage) -> Result<ChatCompletionRequestMessage, ProviderError> {
    match message.role {
        Role::System => Ok(ChatCompletionRequestSystemMessage {
            content: message.content.clone().into(),
            name: None,
        }
        .into()),
        Role::User => Ok(ChatCompletionRequestUserMessage {
            content: message.content.clone().into(),
            name: None,
        }
        .into()),
        Role::Assistant => Ok(ChatCompletionRequestAssistantMessage {
            content: (!message.content.is_empty()).then(|| message.content.clone().into()),
            tool_calls: (!message.tool_calls.is_empty())
                .then(|| message.tool_calls.iter().map(to_openai_tool_call).collect()),
            ..Default::default()
        }
        .into()),
        Role::Tool => Ok(ChatCompletionRequestToolMessage {
            content: message.content.clone().into(),
            tool_call_id: message.tool_call_id.clone().ok_or_else(|| {
                ProviderError::Transport("tool message without tool_call_id".into())
            })?,
        }
        .into()),
    }
}

fn to_openai_tool_call(call: &ToolCallRequest) -> ChatCompletionMessageToolCalls {
    ChatCompletionMessageToolCalls::Function(ChatCompletionMessageToolCall {
        id: call.call_id.clone(),
        function: FunctionCall {
            name: call.name.clone(),
            arguments: call.args.to_string(),
        },
    })
}

fn to_openai_tool(spec: &ToolSpec) -> ChatCompletionTools {
    ChatCompletionTools::Function(ChatCompletionTool {
        function: FunctionObject {
            name: spec.name.clone(),
            description: Some(spec.description.clone()),
            parameters: Some(spec.parameters.clone()),
            strict: None,
        },
    })
}

/// Агрегатор стрім-чанків: текстові дельти віддає одразу, фрагменти tool
/// calls збирає за `index` (id/name/arguments приходять шматками).
#[derive(Default)]
struct ChunkAccumulator {
    text: String,
    tool_calls: BTreeMap<u32, PartialToolCall>,
}

#[derive(Default)]
struct PartialToolCall {
    id: String,
    name: String,
    arguments: String,
}

impl ChunkAccumulator {
    /// Поглинає чанк; повертає текстову дельту, якщо вона є.
    fn absorb(&mut self, chunk: CreateChatCompletionStreamResponse) -> Option<String> {
        let delta = chunk.choices.into_iter().next()?.delta;
        for fragment in delta.tool_calls.unwrap_or_default() {
            let slot = self.tool_calls.entry(fragment.index).or_default();
            if let Some(id) = fragment.id {
                slot.id = id;
            }
            if let Some(function) = fragment.function {
                if let Some(name) = function.name {
                    slot.name.push_str(&name);
                }
                if let Some(arguments) = function.arguments {
                    slot.arguments.push_str(&arguments);
                }
            }
        }
        let text = delta.content.filter(|content| !content.is_empty())?;
        self.text.push_str(&text);
        Some(text)
    }

    /// Фінал стріму → нейтральний [`Completion`]; невалідний JSON
    /// аргументів tool call-а — явна транспортна помилка.
    fn finish(self) -> Result<Completion, ProviderError> {
        let tool_calls = self
            .tool_calls
            .into_values()
            .map(|partial| {
                let args = if partial.arguments.trim().is_empty() {
                    Value::Null
                } else {
                    serde_json::from_str(&partial.arguments).map_err(|error| {
                        ProviderError::Transport(format!(
                            "невалідний JSON аргументів tool call `{}`: {error}",
                            partial.name
                        ))
                    })?
                };
                Ok(ToolCallRequest {
                    call_id: partial.id,
                    name: partial.name,
                    args,
                })
            })
            .collect::<Result<Vec<_>, ProviderError>>()?;
        Ok(Completion {
            text: self.text,
            tool_calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(delta_json: &str) -> CreateChatCompletionStreamResponse {
        serde_json::from_value(serde_json::json!({
            "id": "chatcmpl-1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "test",
            "choices": [{ "index": 0, "delta": serde_json::from_str::<Value>(delta_json).unwrap(), "finish_reason": null }]
        }))
        .unwrap()
    }

    /// Текстові дельти віддаються в міру надходження і збираються у фінал.
    #[test]
    fn accumulator_streams_text_deltas() {
        let mut accumulator = ChunkAccumulator::default();
        assert_eq!(
            accumulator.absorb(chunk(r#"{"content": "При"}"#)),
            Some("При".into())
        );
        assert_eq!(
            accumulator.absorb(chunk(r#"{"content": "віт"}"#)),
            Some("віт".into())
        );
        let completion = accumulator.finish().unwrap();
        assert_eq!(completion.text, "Привіт");
        assert!(completion.tool_calls.is_empty());
    }

    /// Фрагменти tool call-а (id/name у першому чанку, arguments шматками)
    /// збираються у один ToolCallRequest із розпарсеними args.
    #[test]
    fn accumulator_assembles_tool_call_fragments() {
        let mut accumulator = ChunkAccumulator::default();
        assert_eq!(
            accumulator.absorb(chunk(
                r#"{"tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "echo", "arguments": "{\"te"}}]}"#
            )),
            None
        );
        assert_eq!(
            accumulator.absorb(chunk(
                r#"{"tool_calls": [{"index": 0, "function": {"arguments": "xt\": \"hi\"}"}}]}"#
            )),
            None
        );
        let completion = accumulator.finish().unwrap();
        assert_eq!(
            completion.tool_calls,
            vec![ToolCallRequest {
                call_id: "call_1".into(),
                name: "echo".into(),
                args: serde_json::json!({ "text": "hi" }),
            }]
        );
    }

    #[test]
    fn accumulator_rejects_invalid_tool_args_json() {
        let mut accumulator = ChunkAccumulator::default();
        accumulator.absorb(chunk(
            r#"{"tool_calls": [{"index": 0, "id": "c", "function": {"name": "echo", "arguments": "{оборвано"}}]}"#,
        ));
        let error = accumulator.finish().unwrap_err();
        assert!(matches!(error, ProviderError::Transport(message) if message.contains("echo")));
    }

    /// Нейтральна історія (включно з assistant+tool_calls і tool-результатом)
    /// мапиться на ролі OpenAI-протоколу.
    #[test]
    fn build_request_maps_roles_tools_and_history() {
        let request = CompletionRequest {
            model: "gpt-test".into(),
            messages: vec![
                ChatMessage::system("протокол"),
                ChatMessage::user("зроби echo"),
                ChatMessage::assistant_with_tool_calls(
                    "",
                    vec![ToolCallRequest {
                        call_id: "call_1".into(),
                        name: "echo".into(),
                        args: serde_json::json!({ "text": "hi" }),
                    }],
                ),
                ChatMessage::tool_result("call_1", "\"hi\""),
                ChatMessage::assistant("готово"),
            ],
            tools: vec![ToolSpec {
                name: "echo".into(),
                description: "Повертає текст".into(),
                parameters: serde_json::json!({ "type": "object" }),
            }],
        };
        let openai_request = build_request(&request).unwrap();
        let json = serde_json::to_value(&openai_request).unwrap();

        assert_eq!(json["model"], "gpt-test");
        let roles: Vec<&str> = json["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|message| message["role"].as_str().unwrap())
            .collect();
        assert_eq!(roles, ["system", "user", "assistant", "tool", "assistant"]);
        assert_eq!(json["messages"][2]["tool_calls"][0]["id"], "call_1");
        assert_eq!(json["messages"][3]["tool_call_id"], "call_1");
        assert_eq!(json["tools"][0]["function"]["name"], "echo");
        assert_eq!(json["tools"][0]["function"]["parameters"]["type"], "object");
    }

    /// Tool-повідомлення без call id — явна помилка, не мовчазний пропуск.
    #[test]
    fn tool_message_without_call_id_is_rejected() {
        let mut message = ChatMessage::tool_result("x", "y");
        message.tool_call_id = None;
        let error = to_openai_message(&message).unwrap_err();
        assert!(matches!(error, ProviderError::Transport(text) if text.contains("tool_call_id")));
    }
}
