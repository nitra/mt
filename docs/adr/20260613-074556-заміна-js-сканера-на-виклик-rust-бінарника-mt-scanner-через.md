---
session: df66316d-5f33-46ff-9915-5ff3c75291de
captured: 2026-06-13T07:45:56+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-mt/df66316d-5f33-46ff-9915-5ff3c75291de.jsonl
---

## ADR Заміна JS-сканера на виклик Rust-бінарника `mt-scanner` через `spawnSync`

## Context and Problem Statement
У проєкті існували дві паралельні реалізації однієї логіки: `scanner/` (Rust-бінарник `mt-scanner`) і `npm/lib/core/scanner.mjs` (самостійна JS-реалізація на `node:fs`). JS-версія ніколи не викликала Rust; бінарник фактично не використовувався в рантаймі npm-пакета.

## Considered Options
* Залишити обидві реалізації (поточний стан)
* Видалити JS-реалізацію; `scanner.mjs` стає тонким шимом, що викликає `mt-scanner scan <mtDir>` через `spawnSync` і адаптує JSON-вихід до контракту споживачів

## Decision Outcome
Chosen option: "Видалити JS-реалізацію, замінити на `spawnSync`-шим", because користувач сформулював вимогу: «потрібно щоб js реалізації не існувало, а вона викликала rust варіант».

### Consequences
* Good, because transcript фіксує очікувану користь: єдина реалізація логіки скану, усуває синхронізацію двох кодових баз.
* Bad, because transcript фіксує: контракти JS і Rust розходяться (snake_case стани, відсутність поля `dir`, `is_composite` vs `composite`, вкладене дерево vs плоский список) — потрібен адаптер у шимі.

## More Information
Файли: `npm/lib/core/scanner.mjs`, `scanner/src/lib.rs`, `scanner/src/main.rs`. Споживачі шима: `scan.mjs`, `status.mjs`, `run.mjs`, `invalidate.mjs`, `watch.mjs`, `kill.mjs`, `npm/index.js` (публічний експорт `findTasks`, `getActiveWorktrees`, `parseWorktreeList`). Специфікація рефакторингу: `docs/spec-scanner-rust-integration.md`.

---

## ADR Доставка Rust-бінарника через `optionalDependencies` (2 платформи: darwin-arm64 + linux-x64 musl-static)

## Context and Problem Statement
`target/` лежить у `.gitignore`; `@7n/mt` не містить бінарника і не має build-кроку — без рішення про доставку npm-пакет падатиме у рантаймі після заміни JS-сканера.

## Considered Options
* (A) `postinstall: cargo build --release` — вимагає Rust-тулчейн у кожного користувача
* (B) Prebuilt бінарники через `optionalDependencies` (як esbuild/swc)
* (C) Бінарник у `files` головного пакета

## Decision Outcome
Chosen option: "(B) Prebuilt бінарники через `optionalDependencies`", because користувач підтвердив цей варіант як «правильний прод-шлях».

Зафіксована матриця (підтверджена явно):
| Підпакет | `os` / `cpu` | Rust triple |
|---|---|---|
| `@7n/mt-darwin-arm64` | darwin / arm64 | `aarch64-apple-darwin` |
| `@7n/mt-linux-x64` | linux / x64 (без `libc`) | `x86_64-unknown-linux-musl` (static) |

Один musl-static бінарник без поля `libc` покриває весь Linux x64 (Alpine, Ubuntu, Docker, glibc-дистри). Intel Mac, Linux arm64, Windows — поза scope першого релізу.

### Consequences
* Good, because transcript фіксує: musl-static покриває весь Linux x64 двома підпакетами; CI — 1 `macos-14` job + 1 `ubuntu` job.
* Bad, because transcript фіксує: Intel Mac (`darwin-x64`) не покритий; потребує розширення `npm-publish.yml` під build-матрицю і lockstep-версії підпакетів.

## More Information
Резолвер `scanner-bin.mjs`: `process.env.MT_SCANNER_BIN` → `require.resolve('@7n/mt-' + key + '/mt-scanner' + (win32 ? '.exe' : ''))` → dev-fallback `target/release/mt-scanner`. Пакети: `packages/mt-darwin-arm64/`, `packages/mt-linux-x64/`. CI tooling для musl (`cargo-zigbuild` vs `musl-tools`) лишилось відкритим питанням (§9.2 специфікації).

---

## ADR Вся робота з файловою системою — виключно в Rust

## Context and Problem Statement
Після рішення викликати Rust-бінарник через шим постало питання: де залишити логіку визначення стану `running` (яка в JS залежала від активних git-worktree через `getActiveWorktrees`). Виконувати цю перевірку в JS-шимі означало б збереження FS-роботи в JS-шарі.

## Considered Options
* Post-process у JS-шимі: `mt-scanner scan` повертає дерево, JS накладає worktree→`running` поверх
* Перенести виявлення активних worktree в Rust: `mt-scanner scan` сам викликає `git worktree list --porcelain` і виставляє стан `running`

## Decision Outcome
Chosen option: "Перенести виявлення worktree в Rust", because користувач сформулював принцип: «все що стосується роботи з файловою системою повинно бути rust».

### Consequences
* Good, because transcript фіксує очікувану користь: JS-шим стає без-FS тонким адаптером; єдина точка FS-логіки — Rust.
* Bad, because `sanitizeTaskName` (конвенція іменування worktree) потрібно продублювати в Rust для матчингу; JS-копія лишається тільки для `mt run` (створення worktree). Transcript вимагає синхронності спільними тест-векторами.

## More Information
`mt-scanner scan` отримує опцію `--worktrees <list>` лише для детермінованих тестів; у production опускається — Rust виконує `git worktree list` сам. `sanitizeTaskName` портується в `scanner/src/lib.rs`. Файли: `npm/lib/core/state.mjs` (функції `deriveNodeState`, `isComposite` — видаляються), `scanner/src/lib.rs` (розширюється). Специфікація: `docs/spec-scanner-rust-integration.md §5`.
