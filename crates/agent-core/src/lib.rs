//! Ядро агента (`agent-core`) — agent loop, tools, provider (спека
//! npm/docs/architecture/stack.md, компонент `agent-core`).
//!
//! Крейт БЕЗ tauri (фізична межа зі stack.md; tokio дозволений). Емітить
//! події `agent-protocol` через callback — Envelope (seq/ts/адресація)
//! збирає agent-server, не ядро. Провайдер — нейтральний контракт:
//! типи конкретного SDK не протікають у публічний API.

pub mod agent;
pub mod fs_tools;
pub mod provider;
pub mod provider_openai;
pub mod tools;

pub use agent::{Agent, AgentError};
pub use fs_tools::register_workspace_tools;
pub use provider::{
    ChatMessage, Completion, CompletionRequest, MockProvider, Provider, ProviderError, Role,
    StreamEvent, ToolCallRequest, ToolSpec,
};
pub use provider_openai::OpenAiProvider;
pub use tools::{Tool, ToolError, ToolOutput, ToolRegistry};
