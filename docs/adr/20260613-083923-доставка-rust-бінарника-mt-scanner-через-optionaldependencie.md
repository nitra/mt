---
session: df66316d-5f33-46ff-9915-5ff3c75291de
captured: 2026-06-13T08:39:23+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-mt/df66316d-5f33-46ff-9915-5ff3c75291de.jsonl
---

Розроблю ADR-блоки безпосередньо на основі зафіксованих рішень з транскрипту.

---

## ADR Доставка Rust-бінарника `mt-scanner` через `optionalDependencies` платформних підпакетів

## Context and Problem Statement

Rust-бінарник `mt-scanner` повинен бути доступний у рантаймі `@7n/mt` після видалення JS-реалізації сканера. Директорія `target/` перебуває в `.gitignore` і не публікується з npm-пакетом, тому без окремого рішення пакет не зможе знайти бінарник.

## Considered Options

* **(A) `postinstall`: `cargo build --release`** — при встановленні пакету виконується збірка локально
* **(B) Prebuilt бінарники через `optionalDependencies`** — платформні підпакети (`@7n/mt-darwin-arm64`, `@7n/mt-linux-x64`) з полями `os`/`cpu`, CI збирає та публікує їх; головний пакет декларує їх як optional
* **(C) Бінарник у `files` головного пакету** — один або кілька бінарників вкладені в `npm/`

## Decision Outcome

Chosen option: "Prebuilt бінарники через `optionalDependencies`", because модель esbuild/swc є стандартною для Rust-CLI у npm-екосистемі, не вимагає Rust-тулчейну на машині кінцевого користувача (на відміну від A), є портабельною між платформами (на відміну від C) і дозволяє додавати нові платформи як нові підпакети без зміни основного коду.

### Consequences

* Good, because `npm install` на підтримуваній платформі встановлює лише відповідний підпакет і бінарник готовий без будь-яких додаткових кроків; решта optional-пакетів тихо пропускається.
* Bad, because потрібна CI-матриця: кожна нова платформа — окремий job і окрема npm-публікація підпакету з синхронізованою версією.

## More Information

- `packages/mt-darwin-arm64/package.json` — `{ "os": ["darwin"], "cpu": ["arm64"] }`
- `packages/mt-linux-x64/package.json` — `{ "os": ["linux"], "cpu": ["x64"] }` (без поля `libc` — musl-static бінарник працює і на glibc, і на musl)
- `npm/package.json` — `optionalDependencies: { "@7n/mt-darwin-arm64": "0.2.0", "@7n/mt-linux-x64": "0.2.0" }`
- Резолвер: `npm/lib/core/scanner-bin.mjs` — порядок: `MT_SCANNER_BIN` env → `require.resolve('@7n/mt-<key>/<binName>')` → dev-fallback `target/release/mt-scanner` → зрозуміла помилка
- `binName` додає суфікс `.exe` на `win32` як forward-compat для майбутнього підпакету Windows
- `.gitignore` — `packages/*/mt-scanner` і `packages/*/mt-scanner.exe`

---

## ADR Початкова матриця платформ: 2 підпакети — `darwin-arm64` і `linux-x64` (musl-static без `libc`)

## Context and Problem Statement

Обрана модель `optionalDependencies` потребує визначення конкретного набору платформних підпакетів. Теоретична матриця нараховує 10 комбінацій (macOS arm64/x64, Linux x64/arm64 glibc/musl, Windows x64/arm64, FreeBSD, armv7); підтримка кожної коштує CI-job і npm-пакет.

## Considered Options

* **Повна матриця (10 платформ)** — покриває всі можливі комбінації
* **Minimal (3 пакети):** `darwin-arm64` + `darwin-x64` + `linux-x64-musl`
* **2 пакети: `darwin-arm64` + `linux-x64` musl-static (без `libc`)** — покриває команду зараз

## Decision Outcome

Chosen option: "2 пакети: `darwin-arm64` + `linux-x64` musl-static (без `libc`)", because команда використовує Apple Silicon Mac і Linux x64 (CI/Docker); musl-static бінарник без поля `libc` покриває весь Linux x64 одним пакетом (і glibc, і musl-дистрибутиви); Intel Mac, Windows, linux-arm64 свідомо відкладено як add-only (резолвер і Rust-код не потребують змін при їх додаванні).

### Consequences

* Good, because мінімальна CI-інфраструктура на старті: 1 native `macos-14` job + 1 `ubuntu` job з `cargo-zigbuild`; додавання нової платформи = новий підпакет + новий CI job без змін у логіці.
* Bad, because transcript фіксує усвідомлену відсутність покриття: Intel Mac (`darwin-x64`) не запустить бінарник без додаткового підпакету; Linux arm64 (Graviton, Docker на Apple Silicon) теж не покритий.

## More Information

- `cargo-zigbuild` обрано для Linux musl-збірки замість `musl-tools + rustup target add`: дозволяє крос-збирати `aarch64-unknown-linux-musl` з того самого `ubuntu`-раннера без додаткового тулчейну, коли linux-arm64 буде додано
- CI target triples: `aarch64-apple-darwin` (macos-14) і `x86_64-unknown-linux-musl` (ubuntu + zigbuild)
- `.github/workflows/npm-publish.yml` — оновлено: `build-matrix` → `assemble` → `release-publish` → `publish-platform-pkgs` (впорядкована публікація)
- Trigger розширено: `scanner/**` і `packages/**` поряд із `npm/**`

---

## ADR Вся робота з файловою системою — в Rust; `worktree→running` переноситься в бінарник

## Context and Problem Statement

Після рішення викликати Rust-бінарник із JS-шима постало питання: де виконувати `worktree→running` — підвищення стану задачі до `running`, якщо для неї існує активний git-worktree. JS-реалізація робила це post-process кроком у `scanTasks`, отримуючи список worktree через `listActiveWorktrees` (JS `execSync`). Специфікація вимагала явного рішення.

## Considered Options

* **JS post-process:** Rust повертає дерево без `running`-стану; JS-шим отримує список worktree і підвищує стан самостійно
* **Rust-internal discovery:** `mt-scanner scan` сам виконує `git worktree list --porcelain`, застосовує `sanitize_task_name` для матчингу і повертає `running`-стан у JSON

## Decision Outcome

Chosen option: "Rust-internal discovery", because директива користувача — «все що стосується роботи з файловою системою повинно бути Rust»; виклик `git` і читання ФС для матчингу worktree є файловою операцією, тому JS не повинен цього торкатися.

### Consequences

* Good, because JS-шим стає суто тонким адаптером (запуск бінарника + JSON-парсинг + flatten поля + мапінг станів); жодних FS-операцій у JS.
* Bad, because `sanitizeTaskName` (конвенція іменування worktree) тепер існує в двох місцях — `scanner/src/lib.rs` (для матчингу) і `npm/lib/core/state.mjs` (для створення worktree в `mt run`); синхронізація через спільні тест-вектори є необхідною умовою коректності.

## More Information

- `scanner/src/lib.rs` — `discover_worktrees(tasks_root)`: викликає `git worktree list --porcelain`, парсить `worktree <path>` рядки, повертає `Vec<String>` імен (останній компонент шляху)
- `scanner/src/lib.rs` — `sanitize_task_name(s)`: портована логіка з JS `state.mjs`; використовується для матчингу worktree-імені проти task-path при визначенні стану `running`
- `scanner/src/main.rs` — `mt-scanner scan <dir> [--worktrees w1,w2,...]`: прапор `--worktrees` дозволяє детерміновані тести без реального `git`; у проді пропускається — бінарник сам виявляє
- `npm/lib/core/state.mjs` — `sanitizeTaskName` збережено для `mt run` (створення worktree); `deriveNodeState`/`isComposite` видалено
- 30 Rust unit-тестів (`#[cfg(test)]` у `lib.rs`) відтворюють кейси з `state.test.mjs`, включно з `worktree→running` і `sanitize`-векторами; `cargo test` зелений
