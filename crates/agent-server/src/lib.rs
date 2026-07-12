//! Мінімальний agent-server (M1: одна машина, локальний WS, без relay) —
//! session host протоколу v4 (спека npm/docs/architecture/runtime.md).
//!
//! Обовʼязки: збірка `Envelope` (seq/ts/адресація) навколо подій
//! `agent-core`, журнал `session.jsonl`, broadcast клієнтам, реплей за
//! `want_replay_from`, capability-фільтр, хендшейк v4, port-file discovery.
//! Graph-операції (claim, fenced publish, push run ref) сюди НЕ входять —
//! за правилом одного коду контракту (stack.md) їх виконує `mt … --json`;
//! інтеграція — окрема задача.

pub mod discovery;
pub mod graph;
pub mod relay_client;
pub mod runner;
pub mod session;
pub mod ws;

pub use discovery::{token_hash, Discovery, PortFile};
pub use graph::{attach, GraphConfig, InteractiveRun};
pub use relay_client::{spawn_relay_bridge, RelayBridgeConfig};
pub use runner::{AgentTurnRunner, EchoTurnRunner, TurnRunner};
pub use session::{is_ephemeral, Session, SessionHost};
pub use ws::{serve, AppState};
