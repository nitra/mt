//! Виконавці ходу інтерактивної сесії.
//!
//! `UserMessage` клієнта запускає хід агента; всі події ходу емітяться в
//! сесію (Envelope збирає session host). Транспорт виконавця — **ACP (Agent
//! Client Protocol)**: `AcpTurnRunner` (окремий milestone) підключає
//! зовнішній підписочний CLI (claude / codex / cursor / pi) через ACP і
//! мапить `permission-request` на `ApprovalRequest` (ADR `260713-2110`).
//! [`EchoTurnRunner`] — заглушка для demo/CLI і тестів транспорту.

use std::fmt;
use std::path::Path;

use agent_protocol::Event;
use async_trait::async_trait;

/// Помилка ходу виконавця (текстова: транспорт/виконавець повідомляє причину).
#[derive(Debug)]
pub struct TurnError(pub String);

impl fmt::Display for TurnError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for TurnError {}

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
    ) -> Result<String, TurnError>;
}

/// Скриптований виконавець для тестів транспорту/сесій: на кожен хід
/// віддає наступний текст зі скрипту (емітить `AgentTextDelta` +
/// `AgentTextDone`), не викликаючи жодного LLM.
pub struct ScriptedTurnRunner {
    responses: std::sync::Mutex<std::collections::VecDeque<String>>,
}

impl ScriptedTurnRunner {
    /// Створює runner зі списком відповідей (по одній на хід).
    pub fn new<I, S>(responses: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            responses: std::sync::Mutex::new(responses.into_iter().map(Into::into).collect()),
        }
    }
}

#[async_trait]
impl TurnRunner for ScriptedTurnRunner {
    async fn run_turn(
        &self,
        _node_hash: &str,
        _user_text: &str,
        _workdir: Option<&Path>,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, TurnError> {
        let text = self
            .responses
            .lock()
            .expect("responses mutex")
            .pop_front()
            .unwrap_or_default();
        emit(Event::AgentTextDelta { text: text.clone() });
        emit(Event::AgentTextDone {});
        Ok(text)
    }
}

/// Заглушка без LLM: віддзеркалює текст користувача. Для demo `attach`
/// без підключеного ACP-виконавця і для тестів транспорту.
pub struct EchoTurnRunner;

#[async_trait]
impl TurnRunner for EchoTurnRunner {
    async fn run_turn(
        &self,
        _node_hash: &str,
        user_text: &str,
        _workdir: Option<&Path>,
        emit: &(dyn Fn(Event) + Send + Sync),
    ) -> Result<String, TurnError> {
        let text = format!("echo: {user_text}");
        emit(Event::AgentTextDelta { text: text.clone() });
        emit(Event::AgentTextDone {});
        Ok(text)
    }
}
