//! Нейтральний provider-контракт: LLM-транспорт за інтерфейсом.
//!
//! Публічний API не містить типів конкретного SDK (фізична межа зі
//! stack.md: «типи async-openai не протікають назовні provider-реалізації»).
//! Референсний транспорт (OpenAI-compatible Chat Completions через
//! `async-openai`) — окрема реалізація trait-а в наступній задачі;
//! для офлайн-тестів і CI без мережі — [`MockProvider`].

use std::collections::VecDeque;
use std::sync::Mutex;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Роль повідомлення історії.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    System,
    User,
    Assistant,
    /// Результат виконання tool-а (лінкується через `tool_call_id`).
    Tool,
}

/// Повідомлення історії розмови.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    /// Для `Role::Tool` — id виклику, на який відповідає результат.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Для `Role::Assistant` — tool calls цього ходу: OpenAI-compatible
    /// протокол вимагає, щоб tool-результат посилався на попереднє
    /// assistant-повідомлення з відповідним викликом.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCallRequest>,
}

impl ChatMessage {
    fn message(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            tool_call_id: None,
            tool_calls: Vec::new(),
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self::message(Role::System, content)
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::message(Role::User, content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::message(Role::Assistant, content)
    }

    /// Assistant-хід, що просить tool calls (текст може бути порожнім).
    pub fn assistant_with_tool_calls(
        content: impl Into<String>,
        tool_calls: Vec<ToolCallRequest>,
    ) -> Self {
        Self {
            tool_calls,
            ..Self::message(Role::Assistant, content)
        }
    }

    pub fn tool_result(call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            tool_call_id: Some(call_id.into()),
            ..Self::message(Role::Tool, content)
        }
    }
}

/// Опис tool-а для провайдера: `parameters` — JSON Schema (derive через
/// schemars у реєстрі, не руками).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// Запит на завершення ходу.
#[derive(Debug, Clone, PartialEq)]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolSpec>,
}

/// Запит tool call-а від моделі.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCallRequest {
    pub call_id: String,
    pub name: String,
    pub args: Value,
}

/// Стрімінгова подія провайдера (для live-трансляції в сесію).
#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    TextDelta(String),
}

/// Агрегований результат одного завершення.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Completion {
    /// Фінальний текст асистента (може бути порожнім, якщо хід — лише tool calls).
    pub text: String,
    /// Tool calls, які модель просить виконати; порожньо → хід завершено.
    pub tool_calls: Vec<ToolCallRequest>,
}

/// Помилка провайдера.
#[derive(Debug, Clone, PartialEq)]
pub enum ProviderError {
    /// Транспортна/API-помилка з людським поясненням.
    Transport(String),
    /// Скриптованому мок-провайдеру вичерпались відповіді (лише тести).
    ScriptExhausted,
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProviderError::Transport(message) => write!(f, "provider transport error: {message}"),
            ProviderError::ScriptExhausted => write!(f, "mock provider script exhausted"),
        }
    }
}

impl std::error::Error for ProviderError {}

/// LLM-провайдер. `on_event` — стрімінгові дельти для live-трансляції;
/// повний результат — у поверненому [`Completion`].
#[async_trait]
pub trait Provider: Send + Sync {
    async fn complete(
        &self,
        request: CompletionRequest,
        on_event: &(dyn Fn(StreamEvent) + Send + Sync),
    ) -> Result<Completion, ProviderError>;
}

/// Скриптований провайдер для тестів і CI без мережі: віддає заготовлені
/// [`Completion`]-и по черзі, текст стрімить одним delta.
#[derive(Default)]
pub struct MockProvider {
    script: Mutex<VecDeque<Completion>>,
    /// Запити, які реально дійшли до провайдера (для асертів у тестах).
    pub seen_requests: Mutex<Vec<CompletionRequest>>,
}

impl MockProvider {
    pub fn scripted(completions: impl IntoIterator<Item = Completion>) -> Self {
        Self {
            script: Mutex::new(completions.into_iter().collect()),
            seen_requests: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl Provider for MockProvider {
    async fn complete(
        &self,
        request: CompletionRequest,
        on_event: &(dyn Fn(StreamEvent) + Send + Sync),
    ) -> Result<Completion, ProviderError> {
        self.seen_requests.lock().unwrap().push(request);
        let completion = self
            .script
            .lock()
            .unwrap()
            .pop_front()
            .ok_or(ProviderError::ScriptExhausted)?;
        if !completion.text.is_empty() {
            on_event(StreamEvent::TextDelta(completion.text.clone()));
        }
        Ok(completion)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_provider_pops_script_and_streams_text() {
        let provider = MockProvider::scripted([Completion {
            text: "привіт".into(),
            tool_calls: vec![],
        }]);
        let deltas = Mutex::new(Vec::new());
        let request = CompletionRequest {
            model: "mock".into(),
            messages: vec![ChatMessage::user("hi")],
            tools: vec![],
        };
        let completion = provider
            .complete(request.clone(), &|event| {
                deltas.lock().unwrap().push(event);
            })
            .await
            .unwrap();
        assert_eq!(completion.text, "привіт");
        assert_eq!(
            *deltas.lock().unwrap(),
            vec![StreamEvent::TextDelta("привіт".into())]
        );
        assert_eq!(
            provider.seen_requests.lock().unwrap().as_slice(),
            &[request]
        );

        // Другий виклик — скрипт вичерпано.
        let error = provider
            .complete(
                CompletionRequest {
                    model: "mock".into(),
                    messages: vec![],
                    tools: vec![],
                },
                &|_| {},
            )
            .await
            .unwrap_err();
        assert_eq!(error, ProviderError::ScriptExhausted);
    }
}
