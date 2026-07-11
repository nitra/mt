---
schema_version: 1
created_at: 2026-07-11T10:30:12Z
budget_sec: 7200
hint: atomic
---

## Mission

Заскафолдити Rust crate `agent-core` (другий компонент M1 з roadmap): нейтральний provider-контракт (`CompletionRequest`/стрімінгові події) з `MockProvider` для офлайн-тестів, реєстр tools зі schemars-схемами (+ заділ `register_external(...)` для MCP за stack.md), agent loop — історія повідомлень, ітерація tool calls, event-callback, що емітить `Event` з `agent-protocol`. Транспорт `async-openai` і preview-модуль — окремі наступні задачі.

## Done when

- `crates/agent-core/` компілюється у workspace (`cargo check -p agent-core`);
- `Provider` trait + `MockProvider`; `CompletionRequest` нейтральний — жодних типів конкретного SDK у публічному API (межа зі stack.md);
- `Tool` trait: JSON-схема параметрів — derive (`schemars`), не руками; реєстр із заділом `register_external(...)` (MCP, `rmcp` — закоментований намір);
- agent loop `run_turn`: веде історію, виконує цикл tool calls до фінального тексту, емітить `AgentTextDelta`/`ToolCall`/`ToolResult`/`AgentTextDone` (типи `agent-protocol`), має ліміт ітерацій;
- тести: скриптований MockProvider (tool call → фінальний текст) дає очікувану послідовність подій; невідомий tool → `ToolResult { ok: false }` без падіння; ліміт ітерацій → явна помилка;
- `cargo tree -p agent-core -e normal` НЕ містить tauri (фізична межа; tokio дозволений);
- `cargo test -p agent-core` зелений.

## Context

- Нормативні джерела: npm/docs/architecture/runtime.md (події протоколу), npm/docs/architecture/stack.md (межі crate, залежності, «власну реалізацію MCP не писати»), npm/docs/architecture/surfaces.md (MCP як механізм тулів).
- Референсні кодові бази для рішень (не для копіювання): goose (структура core), pi_agent_rust (agent loop: history, tool iteration, event callbacks), codex-rs (server як власник тредів).
- Продовження M0-dogfood: тертя контракту MT занотувати у run-нотатках.
