//! `agent-core` — місце ACP-клієнта (Agent Client Protocol).
//!
//! ACP — **єдиний транспорт AI-викликів** (ADR `260713-2110`): виконавці —
//! зовнішні підписочні CLI (claude / codex / cursor / pi для локальних
//! omlx-моделей), кожен виставляє ACP; `permission-request` ACP мапиться на
//! `ApprovalRequest` протоколу (Ed25519). Власного agent loop, реєстру tools
//! і provider-шару тут НЕМАЄ — це свідомо видалені відхилення від ACP-норми.
//!
//! Скаффолд ACP-клієнта — окремий milestone; до нього крейт порожній.
