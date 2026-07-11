//! Виконавці ходу: міст між сесією і `agent-core`.
//!
//! `UserMessage` клієнта запускає хід агента; всі події ходу емітяться в
//! сесію (Envelope збирає session host). Референсна реалізація —
//! [`AgentTurnRunner`] поверх `agent_core::Agent` (будь-який `Provider`);
//! [`EchoTurnRunner`] — заглушка для demo/CLI без налаштованого провайдера.

use std::collections::HashMap;
use std::sync::Arc;

use agent_core::provider::Provider;
use agent_core::{Agent, AgentError};
use agent_protocol::Event;
use async_trait::async_trait;

/// Виконавець одного ходу кімнати.
#[async_trait]
pub trait TurnRunner: Send + Sync {
    async fn run_turn(
        &self,
        node_hash: &str,
        user_text: &str,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, AgentError>;
}

/// Референсний runner: окремий `Agent` (своя історія) на кожну кімнату.
pub struct AgentTurnRunner<P: Provider> {
    agents: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<Agent<P>>>>>,
    factory: Box<dyn Fn() -> Agent<P> + Send + Sync>,
}

impl<P: Provider> AgentTurnRunner<P> {
    /// `factory` створює агента кімнати (system prompt, tools, модель).
    pub fn new(factory: impl Fn() -> Agent<P> + Send + Sync + 'static) -> Self {
        Self {
            agents: tokio::sync::Mutex::new(HashMap::new()),
            factory: Box::new(factory),
        }
    }

    async fn agent_for(&self, node_hash: &str) -> Arc<tokio::sync::Mutex<Agent<P>>> {
        let mut agents = self.agents.lock().await;
        Arc::clone(
            agents
                .entry(node_hash.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new((self.factory)()))),
        )
    }
}

#[async_trait]
impl<P: Provider> TurnRunner for AgentTurnRunner<P> {
    async fn run_turn(
        &self,
        node_hash: &str,
        user_text: &str,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, AgentError> {
        let agent = self.agent_for(node_hash).await;
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
        let runner = AgentTurnRunner::new(|| {
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

        let first = runner.run_turn("room-1", "раз", &emit).await.unwrap();
        let second = runner.run_turn("room-1", "два", &emit).await.unwrap();

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
}
