---
session: df66316d-5f33-46ff-9915-5ff3c75291de
captured: 2026-06-13T07:39:49+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-mt/df66316d-5f33-46ff-9915-5ff3c75291de.jsonl
---

## ADR Заміна JS-сканера на виклик Rust-бінарника `mt-scanner`

## Context and Problem Statement
У проєкті `@7n/mt` існували дві паралельні реалізації логіки сканування DAG-задач: `scanner/src/lib.rs` (Rust-бінарник `mt-scanner`) та `npm/lib/core/scanner.mjs` (повна JS-копія). JS-реалізація виконувала всю роботу з файловою системою, а Rust-бінарник ніяк не викликався з npm-коду. Ціль — прибрати JS-реалізацію і зробити єдиним джерелом правди Rust.

## Considered Options
* Залишити JS-реалізацію як основну
* Викликати Rust-бінарник через `spawnSync` із JS-шимом, що зберігає існуючу сигнатуру
* Інтеграція через NAPI `.node`-аддон або WASM

## Decision Outcome
Chosen option: "Викликати Rust-бінарник через `spawnSync` із JS-шимом", because весь код, що стосується роботи з файловою системою, має бути виключно в Rust (директива користувача); `mt-scanner` вже компілюється успішно (`cargo build --release`, ~5с) і видає JSON, а `spawnSync` — найпростіший міст без зміни публічної сигнатури `scanTasks`.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина реалізація логіки сканування (в Rust), усунення дублювання `deriveNodeState`/`isComposite` між `state.mjs` і `lib.rs`.
* Bad, because `spawnSync` додає латентність процес-форку на кожен скан; для команди `mt watch` (часті скани) це може бути відчутно — зафіксовано в специфікації як майбутній ризик поза поточним scope.

## More Information
Змінені/створені файли: `docs/spec-scanner-rust-integration.md` (повна специфікація рефакторингу).
Бінарник: `scanner/Cargo.toml`, `scanner/src/main.rs`, `scanner/src/lib.rs`; CLI: `mt-scanner scan <tasks_dir>` → JSON-дерево.
Споживачі, що зберігають сигнатуру: `npm/lib/commands/scan.mjs`, `run.mjs`, `status.mjs`, `invalidate.mjs`, `watch.mjs`, `kill.mjs`, публічний re-export у `npm/index.js`.

---

## ADR Матриця платформ для prebuilt-бінарників `mt-scanner` (optionalDependencies)

## Context and Problem Statement
`target/` знаходиться у `.gitignore`, `npm-publish.yml` не містить кроку `cargo build`, тому після переходу на Rust-бінарник встановлений `@7n/mt` не зміг би знайти `mt-scanner` у рантаймі. Потрібно вибрати модель доставки бінарника кінцевому користувачу.

## Considered Options
* (A) `postinstall`-скрипт із `cargo build --release` — вимагає Rust-тулчейн у кожного користувача
* (B) Prebuilt бінарники по платформах через `optionalDependencies` (як esbuild/swc)
* (C) Покласти бінарник безпосередньо у `files` головного пакета

## Decision Outcome
Chosen option: "(B) optionalDependencies з prebuilt бінарниками", because це стандартна продакшн-модель (esbuild/swc), не вимагає Rust-тулчейну у користувача і дозволяє легко додавати нові платформи без зміни логіки резолвера.

### Consequences
* Good, because transcript фіксує очікувану користь: платформні підпакети ставляться вибірково за `os`/`cpu` — npm/bun самостійно пропускають непотрібні; musl-static бінарник (без поля `libc`) покриває весь Linux-x64 одним пакетом.
* Bad, because потребує розширення `npm-publish.yml` — build-матриця + ordered publish підпакетів перед головним; це більше CI-інфраструктури порівняно з варіантами A і C.

## More Information
Зафіксована матриця (2 пакети на старт): `@7n/mt-darwin-arm64` (`aarch64-apple-darwin`, native `macos-14`) + `@7n/mt-linux-x64` (`x86_64-unknown-linux-musl`, static, без поля `libc`, ubuntu-раннер). Intel Mac, Linux arm64 та Windows — свідомо поза scope першого релізу. Резолвер: `MT_SCANNER_BIN` → `require.resolve('@7n/mt-<platform>-<arch>/mt-scanner')` → dev-fallback `target/release/mt-scanner` → зрозуміла помилка. Специфікація: `docs/spec-scanner-rust-integration.md` §6.

---

## ADR Worktree→running детекція переноситься повністю в Rust

## Context and Problem Statement
JS-сканер визначав стан `running` двома шляхами: `running_*`-sentinel файл на диску ТА наявність активного git-worktree (через `git worktree list`). Rust-бінарник на момент сесії знав лише про sentinel. При переході на `spawnSync` треба було вирішити, де залишиться логіка git-worktree: у JS-шимі як post-process чи переноситься в Rust.

## Considered Options
* JS post-process у шимі: `scanTasks` приймає `activeWorktrees` і підвищує стан після отримання JSON з бінарника
* Перенести виявлення активних worktree (`git worktree list`) у Rust (`mt-scanner scan` сам читає ФС і git)

## Decision Outcome
Chosen option: "Перенести виявлення активних worktree у Rust", because користувач зафіксував принцип: «усе, що стосується роботи з файловою системою, повинно бути в Rust»; `git worktree list` — це читання ФС/git-метаданих.

### Consequences
* Good, because transcript фіксує очікувану користь: JS-шим більше не торкається ФС — виконує лише `spawnSync` і адаптацію JSON-контракту; принцип «єдина точка ФС-логіки» витримано.
* Bad, because конвенцію іменування worktree (`sanitizeTaskName`) доведеться продублювати в Rust для матчингу (JS-копія лишається в `state.mjs`, бо `mt run` створює worktree) — зафіксовано в специфікації як технічний борг.

## More Information
`getActiveWorktrees`/`parseWorktreeList` залишаються в JS, бо вони потрібні `mt run` для створення worktree (не сканування). `sanitizeTaskName` — у `npm/lib/core/state.mjs`, використовується також `worktree.mjs`. Специфікація: `docs/spec-scanner-rust-integration.md` §5.
