//! Виконавці ходу: міст між сесією і `agent-core`.
//!
//! `UserMessage` клієнта запускає хід агента; всі події ходу емітяться в
//! сесію (Envelope збирає session host). Референсна реалізація —
//! [`AgentTurnRunner`] поверх `agent_core::Agent` (будь-який `Provider`);
//! [`EchoTurnRunner`] — заглушка для demo/CLI без налаштованого провайдера.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use agent_core::provider::Provider;
use agent_core::{Agent, AgentError};
use agent_protocol::Event;
use async_trait::async_trait;

/// Виконавець одного ходу кімнати. `workdir` — робоча директорія ходу
/// (worktree інтерактивного run-а); runner-и без файлових тулів її ігнорують.
#[async_trait]
pub trait TurnRunner: Send + Sync {
    async fn run_turn(
        &self,
        node_hash: &str,
        user_text: &str,
        workdir: Option<&Path>,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, AgentError>;
}

/// Фабрика агента кімнати: отримує workdir run-а (worktree run-а).
type AgentFactory<P> = Box<dyn Fn(Option<&Path>) -> Agent<P> + Send + Sync>;

/// Референсний runner: окремий `Agent` (своя історія) на кожну кімнату.
/// Фабрика отримує workdir run-а (worktree) — агент кімнати будується з
/// тулами, піскованими до нього.
pub struct AgentTurnRunner<P: Provider> {
    agents: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<Agent<P>>>>>,
    factory: AgentFactory<P>,
}

impl<P: Provider> AgentTurnRunner<P> {
    /// `factory` створює агента кімнати (system prompt, tools за workdir,
    /// модель).
    pub fn new(factory: impl Fn(Option<&Path>) -> Agent<P> + Send + Sync + 'static) -> Self {
        Self {
            agents: tokio::sync::Mutex::new(HashMap::new()),
            factory: Box::new(factory),
        }
    }

    async fn agent_for(
        &self,
        node_hash: &str,
        workdir: Option<&Path>,
    ) -> Arc<tokio::sync::Mutex<Agent<P>>> {
        let mut agents = self.agents.lock().await;
        Arc::clone(
            agents
                .entry(node_hash.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new((self.factory)(workdir)))),
        )
    }
}

#[async_trait]
impl<P: Provider> TurnRunner for AgentTurnRunner<P> {
    async fn run_turn(
        &self,
        node_hash: &str,
        user_text: &str,
        workdir: Option<&Path>,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, AgentError> {
        let agent = self.agent_for(node_hash, workdir).await;
        let mut agent = agent.lock().await;
        agent.run_turn(user_text, emit).await
    }
}

/// Заглушка без LLM: віддзеркалює текст користувача. Для demo `attach`
/// без налаштованого провайдера і для тестів транспорту.
pub struct EchoTurnRunner;

#[async_trait]
impl TurnRunner for EchoTurnRunner {
    async fn run_turn(
        &self,
        _node_hash: &str,
        user_text: &str,
        _workdir: Option<&Path>,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, AgentError> {
        let text = format!("echo: {user_text}");
        emit(Event::AgentTextDelta { text: text.clone() });
        emit(Event::AgentTextDone {});
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use agent_core::provider::{Completion, MockProvider};
    use agent_core::ToolRegistry;

    use super::*;

    /// Реальна звʼязка з agent-core: скриптований MockProvider через
    /// AgentTurnRunner дає події ходу; історія кімнати зберігається між ходами.
    #[tokio::test]
    async fn agent_turn_runner_keeps_per_room_history() {
        let runner = AgentTurnRunner::new(|_workdir| {
            Agent::new(
                MockProvider::scripted([
                    Completion {
                        text: "перший".into(),
                        tool_calls: vec![],
                    },
                    Completion {
                        text: "другий".into(),
                        tool_calls: vec![],
                    },
                ]),
                ToolRegistry::new(),
                "mock",
                "system",
            )
        });
        let events = Mutex::new(Vec::new());
        let emit = |event: Event| events.lock().unwrap().push(event);

        let first = runner.run_turn("room-1", "раз", None, &emit).await.unwrap();
        let second = runner.run_turn("room-1", "два", None, &emit).await.unwrap();

        assert_eq!((first.as_str(), second.as_str()), ("перший", "другий"));
        assert_eq!(
            *events.lock().unwrap(),
            vec![
                Event::AgentTextDelta {
                    text: "перший".into()
                },
                Event::AgentTextDone {},
                Event::AgentTextDelta {
                    text: "другий".into()
                },
                Event::AgentTextDone {},
            ]
        );
    }

    /// Фабрика з workdir: скриптований tool call `write_file` через
    /// AgentTurnRunner реально створює файл у workdir (worktree run-а).
    #[tokio::test]
    async fn workdir_factory_gives_agent_sandboxed_file_tools() {
        use agent_core::provider::ToolCallRequest;
        use agent_core::register_workspace_tools;

        let workdir = tempfile::tempdir().unwrap();
        let runner = AgentTurnRunner::new(|workdir: Option<&Path>| {
            let mut tools = ToolRegistry::new();
            if let Some(root) = workdir {
                register_workspace_tools(&mut tools, root.to_path_buf());
            }
            Agent::new(
                MockProvider::scripted([
                    Completion {
                        text: String::new(),
                        tool_calls: vec![ToolCallRequest {
                            call_id: "c1".into(),
                            name: "write_file".into(),
                            args: serde_json::json!({
                                "path": "mt/demo/fact_001.md",
                                "content": "## Summary\nok\n"
                            }),
                        }],
                    },
                    Completion {
                        text: "записав".into(),
                        tool_calls: vec![],
                    },
                ]),
                tools,
                "mock",
                "system",
            )
        });

        let text = runner
            .run_turn("room-1", "запиши fact", Some(workdir.path()), &|_| {})
            .await
            .unwrap();

        assert_eq!(text, "записав");
        let written = std::fs::read_to_string(workdir.path().join("mt/demo/fact_001.md")).unwrap();
        assert_eq!(written, "## Summary\nok\n");
    }
}
