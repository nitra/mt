---
type: stack
description: 'Конкретні технологічні рішення реалізації архітектури 0.3.0-draft; зміна стеку не змінює архітектуру'
tags: [stack, rust, bun, tauri]
timestamp: 2026-07-07
---

# Nitra MT — референсний стек

> Доповнення до [цільової архітектури](index.md) 0.3.0-draft. Архітектура technology-agnostic; цей документ фіксує конкретні технологічні рішення референсної реалізації та їх обґрунтування. Зміна стеку не змінює архітектуру.

## Компоненти

| Компонент | Стек | Статус |
| --- | --- | --- |
| `@7n/mt` — CLI-поверхня графа: тонкий клієнт Rust-ядра (`mt-core` через napi) | Bun + plain JS/JSDoc поверх `mt-core` | існує (0.2.x) |
| `mt-core` — ядро графа: scan, create, claim CAS, fenced publish, run wrapper | Rust crate (`serde`, `chrono`, `sha2`) | існує |
| `agent-protocol` — Envelope/Event, підписи, версія протоколу | Rust crate (`serde`, `ed25519-dalek`; без tokio/tauri) | планується |
| `agent-core` — ACP-клієнт (Agent Client Protocol) до зовнішніх CLI-виконавців | Rust crate (`tokio`, ACP; `notify`, `gix` feature-gated) | планується |
| `agent-server` — хост-процес: сесії, транспорти, relay-клієнт, discovery | Rust crate (`axum`, `tokio-tungstenite`, `reqwest`) | планується |
| `agent-cli` — тонкий клієнт + headless (`mt serve`/`attach` фронтенд) | Rust бінарник (`clap`) | планується |
| Desktop-додатки (macOS) | Tauri v2 — тонкий клієнт + lifecycle agent-server | планується |
| Mobile (Android) | Tauri v2 — ЛИШЕ клієнт через relay | планується |
| `ui/` — спільний фронтенд поверхонь | Vue 3 + Vite, plain JS + JSDoc (БЕЗ TypeScript) | планується |
| `relay/` | Bun-сервіс, plain JS + JSDoc; PostgreSQL | планується |

## Правило одного коду контракту

Логіка контракту графа (claim CAS, fenced publish, scan, run wrapper, схеми файлів) реалізована **один раз** — у Rust-ядрі `mt-core`. Обидва споживачі використовують ту саму реалізацію без підпроцесів: `@7n/mt` — тонкий клієнт через napi-аддон (`crates/mt-napi`), `agent-server` — лінкує `mt-core` як crate (`graph.rs`). JS-шар **не** друга імплементація: у ньому лишаються argv, резолв конфіг-шляхів і мапінг помилок в exit-коди. Rust-шар додатково відповідає за те, чого немає в `@7n/mt`: довгоживучий процес, сесії/broadcast, транспорти, preview, підписи, ACP-сесії виконавців.

- Плюс: неможлива розбіжність двох реалізацій fenced publish і run-оркестрації.
- Мінус: JS-поверхня потребує napi-артефакт для платформи (platform-підпакети + dev-fallback `cargo build`).
- Історія: початково контракт жив у `@7n/mt` (JS), а agent-server мав викликати `mt … --json`; перенесення в Rust — ADR `260714-0710` (run wrapper; scan перенесено раніше, ADR `20260613-071723`).

## Контракт як пакет: `@7n/mt-contract` + conformance-suite

Контракт (файловий стан у git + канонічний JSON скану) — єдиний інтерфейс між шарами: Rust (`mt-core`) — єдина імплементація, JS-шар — не друга імплементація, а тонкий клієнт поверх Rust-рушія. Щоб ця межа була тестованою, а не декларативною, контракт фіксується окремим пакетом `npm/contract/` (`@7n/mt-contract`, `private: true`):

- **`schemas/`** — JSON Schema: frontmatter `task.md`, sentinel-файли, layout `deps/`; канонічний вихід скану (`TaskNode[]`); плаский вихід адаптера (`TaskInfo[]`);
- **`states.md`** — нормативний зріз станів і переходів (актуальне зведення; ADR лишаються історією рішень);
- **`fixtures/cases/<name>/`** — golden-кейси: `mt/` (вхідне дерево) + `expected/scan.json` + `expected/flat.json`;
- **`lib/`** — conformance-runner (ajv-валідація + порівняння expected/actual).

Обидва споживачі перевіряються **незалежно**, спільна точка істини — fixtures: Rust-тести ганяють скан по `cases/*/mt/` проти `expected/scan.json` («правильно сканую ФС»); JS-тести годують `scan.json` у flatten/kebab-адаптер проти `expected/flat.json` **без запуску Rust** («правильно адаптую»). Розбіжність між реалізаціями ловиться поштучно і з чітким винуватцем.

- **Semver контракту:** major — зміна семантики станів чи формату; minor — back-compatible додавання; patch — нові fixtures/уточнення текстів.
- **Впровадження** — два add-only PR: пакет зі схемами/fixtures/runner-ом → conformance-тест у Rust CI (розбіжності, які він виявить, — калібрування контракту). Нічого не рухається і не перейменовується.
- **Не змінюється:** семантика станів і формат файлового контракту (лише фіксується), модель доставки платформних артефактів, порядок пошуку аддона.
- **Публікація в registry** — окреме рішення при появі зовнішнього споживача; тоді ж повертатись до питання схеми агентського протоколу (`agent-protocol`) у складі контракту.

## Фізичні межі (перевіряються в CI)

- `agent-core` НЕ залежить від `tauri` — фейл CI, якщо `cargo tree -p agent-core -e normal` містить `tauri`;
- `agent-protocol` без tokio/tauri — чистий контракт;
- relay НЕ імпортує нічого з agent-* — спілкується лише протоколом.

## Виконавці та AI-транспорт

- **Виконавці — підписочні CLI** (`agent_cli`: claude | codex | cursor | pi; [runtime.md](runtime.md#підписочні-cli-виконавці-agent_cli)): auth, вибір моделі, tools і білінг — на боці CLI під підпискою користувача. MT не тримає ключів; власного provider-шару і LiteLLM-прокладки **немає** (видалені).
- **Локальні моделі — pi.dev CLI поверх omlx**: pi обгортає локальний omlx-сервер і є таким самим виконавцем (`agent_cli: pi`), як хмарні.
- **Конфігурація виконавців — user-level ENV** (`MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`, `MT_AGENT_CLI_MODEL_MAP`), не `.mt.json`: підписки і моделі — властивість користувача, спільна для всіх репозиторіїв.
- **Кілька хмарних підписок — каскад** `MT_CLOUD_AGENT_CLIS`: вичерпані ліміти одного CLI → автоматичний перехід до наступного.
- MIN/AVG/MAX — канон тирів: tier резолвиться у конкретну модель CLI через `MT_AGENT_CLI_MODEL_MAP[<cli>][tier]`; без мапінгу CLI вирішує сам (тир — hint `MT_MODEL_TIER`).
- **ACP (Agent Client Protocol) — єдиний транспорт усіх AI-викликів**: один ACP-клієнт в agent-server; `permission-request` → `ApprovalRequest` (Ed25519).
- MCP-тули підключаються через штатний `mcp_servers`-механізм самих CLI (декларація — surfaces.md); власної MCP-реалізації в MT немає.

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

- Rust: `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace` (без мережі: ScriptedTurnRunner, локальний bare-репо як remote);
- перевірка межі agent-core ↔ tauri (вище);
- Bun: `bun test` для relay і `@7n/mt`; ключові кейси: CAS-конфлікт двох хостів, takeover протухлого claim, handoff, membership-роутінг кімнат, viewer не шле клієнтські події, флоу invite→accept→MemberChanged, transfer ownership, відхилення підпису пристрою поза pubkey-списком, відхилення несумісної protocol_version;
- Tauri: `cargo check` обох додатків; build-job-и — заглушки до стабілізації.

## Мова

Коментарі в коді та документація — українською; ідентифікатори, commit-повідомлення файлів контракту, назви подій/полів — англійською.

## Референсні кодові бази (для рішень, не для копіювання)

- `openai/codex` (codex-rs) — App Server: JSON-RPC-сервер як єдиний власник тредів, поверхні — тонкі клієнти;
- `aaif-goose/goose` — структура workspace (core/cli/server/mcp), sessions/providers/config;
- `Dicklesworthstone/pi_agent_rust` — agent loop: message history, tool iteration, event callbacks.
