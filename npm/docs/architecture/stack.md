---
type: stack
description: 'Конкретні технологічні рішення реалізації архітектури 0.3.0-draft; зміна стеку не змінює архітектуру'
tags: [stack, rust, bun, tauri]
timestamp: 2026-07-07
---

# Nitra MT — референсний стек

> Доповнення до [цільової архітектури](index.md) 0.3.0-draft. Архітектура technology-agnostic; цей документ фіксує конкретні технологічні рішення референсної реалізації та їх обґрунтування. Зміна стеку не змінює архітектуру.

## Суть

Цей документ фіксує технологічні рішення, які реалізують референсний стек для Nitra MT, слугуючи доповненням до загальної архітектури. Основний логічний контракт графа повністю інкапсульовано у `@7n/mt` (Bun/JS), забезпечуючи єдність бізнес-правил. Rust-компоненти реалізують довгоживучий хост-процес, використовуючи цей контракт через виклики підпроцесів, а не реімплементацію. Вся інфраструктура, від LLM-провайдерів до механізмів з'єднання, стандартизована навколо OpenAI-сумісного транспорту та явних меж ізоляції між компонентами.

Changelog:

## Компоненти

| Компонент | Стек | Статус |
| --- | --- | --- |
| `@7n/mt` — ядро графа: CLI, claim/fenced publish, scan, wrapper | Bun + plain JS/JSDoc | існує (0.2.x) |
| `agent-protocol` — Envelope/Event, підписи, версія протоколу | Rust crate (`serde`, `ed25519-dalek`; без tokio/tauri) | планується |
| `agent-core` — agent loop, tools, provider, preview | Rust crate (`tokio`, `async-openai`, `schemars`, `notify`, `gix` feature-gated) | планується |
| `agent-server` — хост-процес: сесії, транспорти, relay-клієнт, discovery | Rust crate (`axum`, `tokio-tungstenite`, `reqwest`) | планується |
| `agent-cli` — тонкий клієнт + headless (`mt serve`/`attach` фронтенд) | Rust бінарник (`clap`) | планується |
| Desktop-додатки (macOS) | Tauri v2 — тонкий клієнт + lifecycle agent-server | планується |
| Mobile (Android) | Tauri v2 — ЛИШЕ клієнт через relay | планується |
| `ui/` — спільний фронтенд поверхонь | Vue 3 + Vite, plain JS + JSDoc (БЕЗ TypeScript) | планується |
| `relay/` | Bun-сервіс, plain JS + JSDoc; PostgreSQL | планується |

## Правило одного коду контракту

Логіка контракту графа (claim CAS, fenced publish, scan, схеми файлів) реалізована **один раз** — у `@7n/mt`. `agent-server` (Rust) **не реімплементує** її: викликає `mt … --json` як підпроцес для graph-операцій. Rust-шар відповідає за те, чого немає в `@7n/mt`: довгоживучий процес, сесії/broadcast, транспорти, preview, підписи, provider-стрімінг.

- Плюс: неможлива розбіжність двох реалізацій fenced publish.
- Мінус: залежність agent-server від Bun у PATH — фіксується в discovery/preflight (`mt doctor`-перевірка).
- Перегляд рішення (перенесення контракту в Rust) — окремий ADR, лише після стабілізації протоколу.

## Фізичні межі (перевіряються в CI)

- `agent-core` НЕ залежить від `tauri` — фейл CI, якщо `cargo tree -p agent-core -e normal` містить `tauri`;
- `agent-protocol` без tokio/tauri — чистий контракт;
- типи `async-openai` не протікають назовні provider-реалізації; `CompletionRequest` — нейтральний;
- relay НЕ імпортує нічого з agent-* — спілкується лише протоколом.

## LLM-провайдери

- Транспорт — **OpenAI-compatible Chat Completions** (`async-openai`, `base_url` через config) як мінімальний спільний знаменник: omlx, Ollama, LM Studio, LiteLLM.
- Хмарні моделі (Anthropic та ін.) — через LiteLLM-профіль; `model_map` (MIM/AVG/MAX) з `.mt.json` резолвиться у `provider_profiles`.
- Tool-схеми — derive (`schemars`), не руками; SSE-парсинг і збірку tool calls руками не писати.
- MCP: заділ `register_external(...)` у реєстрі tools + закоментований `rmcp`; власну реалізацію MCP не писати.

## Git-операції

- Десктоп/сервери: системний `git` через підпроцес (як у `@7n/mt`);
- Android: `gix` (feature `android`) — mobile все одно ЛИШЕ клієнт, git потрібен хіба для read-only сценаріїв майбутнього.

## Ключі та keystore

- macOS: Keychain; Android: Keystore; Linux/headless: файл 0600 (fallback);
- скафолд стартує з файлового fallback + TODO на платформенні keystore.

## Relay-інфраструктура

- Bun + PostgreSQL; auth — інтерфейс `verifySession(token) → {account_id}` із dev-реалізацією (magic tokens), продакшн — Ory Kratos за тим самим інтерфейсом;
- Push: FCM (data-повідомлення трьох типів — див. [access.md](access.md)); модуль за інтерфейсом, dev-заглушка;
- Деплой: Dockerfile (oven/bun) + k8s (Deployment + Service; Postgres — CNPG);
- Ліміти: rate limit на з'єднання, кадр ≤ 2 MB, буфер ≤ 200 Envelope/run.

## Демонізація agent-server

- macOS: launchd plist; Linux: systemd unit (приклади в `deploy/`);
- discovery port-file: `~/.nitra/server.port` (port + pid + токен-хеш) + lock-файл.

## CI

- Rust: `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace` (без мережі: MockProvider, локальний bare-репо як remote);
- перевірка межі agent-core ↔ tauri (вище);
- Bun: `bun test` для relay і `@7n/mt`; ключові кейси: CAS-конфлікт двох хостів, takeover протухлого claim, handoff, membership-роутінг кімнат, viewer не шле клієнтські події, флоу invite→accept→MemberChanged, transfer ownership, відхилення підпису пристрою поза pubkey-списком, відхилення несумісної protocol_version;
- Tauri: `cargo check` обох додатків; build-job-и — заглушки до стабілізації.

## Мова

Коментарі в коді та документація — українською; ідентифікатори, commit-повідомлення файлів контракту, назви подій/полів — англійською.

## Референсні кодові бази (для рішень, не для копіювання)

- `openai/codex` (codex-rs) — App Server: JSON-RPC-сервер як єдиний власник тредів, поверхні — тонкі клієнти;
- `aaif-goose/goose` — структура workspace (core/cli/server/mcp), sessions/providers/config;
- `Dicklesworthstone/pi_agent_rust` — agent loop: message history, tool iteration, event callbacks.
