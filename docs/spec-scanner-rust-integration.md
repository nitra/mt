# Специфікація рефакторингу: заміна JS-сканера на Rust-бінарник `mt-scanner`

Статус: **погоджено — готово до реалізації** (всі рішення зафіксовані; §9.4 workspaces свідомо відкладено)
Дата: 2026-06-13

> **Принцип (директива користувача):** _усе, що стосується роботи з файловою системою, має бути в Rust._ JS не виконує жодних ФС-читань для скану — включно з виявленням активних worktree (це переноситься в Rust, §5). JS-шар лише запускає бінарник, парсить JSON і робить чисто-графові операції (топосорт) над результатом.
> Пов'язані ADR: `20260613-071723-заміна-js-сканера-на-виклик-rust-бінарника-mt-scanner.md`, `20260611-193434-вирівнювання-scanner-state-з-специфікацією-mt.md`

## 1. Мета і scope

Видалити самостійну JS-реалізацію сканування DAG задач (`npm/lib/core/scanner.mjs` + частину `state.mjs`) і делегувати скан Rust-бінарнику `mt-scanner`, який стає **єдиним джерелом істини** для виявлення задач і деривації станів.

JS-шар залишається тонким адаптером: запускає бінарник, парсить JSON, приводить вихід до контракту, який очікують команди (`scan/status/run/invalidate/watch/kill`), і виконує дві речі, що не належать ФС-скану: топосорт графа і узгодження runtime-стану worktree.

**Поза scope:** зміна семантики станів, зміна формату файлового контракту вузла, Windows-підтримка.

## 2. Зафіксовані рішення

1. **Виклик** — `spawnSync(bin, ['scan', mtDir], { encoding: 'utf8' })`, парсинг `stdout` як JSON. (з ADR `…071723`)
2. **Доставка бінарника** — модель esbuild/swc: головний пакет без бінарника, платформні підпакети в `optionalDependencies`.
3. **Платформи на старті — рівно 2:**

   | Підпакет              | `os`/`cpu`/`libc`            | Rust target triple                   | покриття                                        |
   | --------------------- | ---------------------------- | ------------------------------------ | ----------------------------------------------- |
   | `@7n/mt-darwin-arm64` | darwin / arm64 / —           | `aarch64-apple-darwin`               | усі Apple Silicon                               |
   | `@7n/mt-linux-x64`    | linux / x64 / **без `libc`** | `x86_64-unknown-linux-musl` (static) | **весь** Linux x64 (Alpine, Ubuntu, Docker, CI) |

   Linux — статичний musl-бінарник без поля `libc`, тому один пакет покриває і glibc, і musl на x64. **Не** покриваються: Intel Mac, Linux arm64, Windows — додаються пізніше одним підпакетом кожен без зміни коду шима.

## 3. Розходження контрактів (джерело всієї роботи адаптера)

`scanTasks` зараз повертає **плоский** список; `mt-scanner scan` повертає **вкладене дерево** з іншими полями та snake_case-станами.

| Аспект                 | JS `scanTasks` (зараз)                                   | Rust `mt-scanner scan`                          | Дія адаптера                                                            |
| ---------------------- | -------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| структура              | плоский `TaskInfo[]`                                     | вкладене `TaskNode[]` (`children: TaskNode[]`)  | **flatten** дерева в плоский список                                     |
| `id`/`path`            | `id == path == relPath` (відносний від mt/)              | `id` = ім'я листа, `path` = відносний шлях      | використовувати `path` як `id` і `path`                                 |
| `dir`                  | абсолютний шлях (потрібен `run.mjs`)                     | **немає**                                       | відновити: `join(mtDir, node.path)`                                     |
| composite              | `composite: boolean`, `children: string[]` (шляхи дітей) | `is_composite: boolean`, `children: TaskNode[]` | `composite = is_composite`; `children = node.children.map(c => c.path)` |
| стани                  | kebab: `pending-audit`, `plan-review`                    | snake: `pending_audit`, `plan_review`           | `state.replace(/_/g, '-')` (єдиний трансформ покриває всі)              |
| `running` від worktree | так (JS `activeWorktrees`)                               | **переноситься в Rust** (§5)                    | прибрати з JS — Rust сам виявляє worktree й підвищує стан               |
| `agent_retry_max`      | інжектиться через `deps`                                 | Rust читає сам із `.mt.json`                    | прибрати інжекцію; джерело істини — `.mt.json`                          |
| deps                   | з `deps/` директорії                                     | з `deps/` директорії — **семантика збігається** | без змін                                                                |

## 4. Цільова архітектура JS

### 4.1 Резолвер шляху до бінарника — новий модуль `npm/lib/core/scanner-bin.mjs`

Ім'я бінарника: `mt-scanner` + `.exe` на `process.platform === 'win32'` (закладається **зараз**, щоб додавання Windows було add-only — §6.5).

Порядок пошуку:

1. `process.env.MT_SCANNER_BIN` — явний override (dev, CI, тести). Якщо заданий — використати як є.
2. Production: `require.resolve('@7n/mt-' + key + '/' + binName)`, де `key =`${process.platform}-${process.arch}`` (`darwin-arm64`, `linux-x64`, у майбутньому `win32-x64`), `binName = win32 ? 'mt-scanner.exe' : 'mt-scanner'`.
3. Dev-fallback: `<repoRoot>/target/release/mt-scanner`, потім `…/target/debug/mt-scanner`.
4. Інакше — кинути **зрозумілу** помилку:
   `mt-scanner: немає prebuilt для "<key>". Постав MT_SCANNER_BIN=/шлях/до/бінарника або додай підпакет @7n/mt-<key>.`

Резолвер кешує знайдений шлях у модульній змінній (один пошук на процес).

### 4.2 `npm/lib/core/scanner.mjs` — переписати на шим

Зберігає **публічну сигнатуру** (щоб не чіпати 6 команд):

- `scanTasks(mtDir, activeWorktrees, deps = {})`:
  1. `bin = deps.binPath ?? scannerBin()`
  2. `run = deps.spawnSync ?? spawnSync` → `run(bin, ['scan', mtDir, ...wtArgs], { encoding: 'utf8', maxBuffer })`, де `wtArgs` — `--worktrees a,b,c`, якщо `activeWorktrees` **непорожній** (уникає повторного git, бо команда вже його обчислила); інакше аргумент опускається і Rust сам виявляє worktree через `git worktree list` (§5)
  3. `status !== 0` → `throw new Error('mt-scanner failed: ' + stderr)`
  4. `tree = JSON.parse(stdout)`
  5. `nodes = flatten(tree, mtDir)` — рекурсивно, з мапінгом полів §3
  6. `return nodes` (плоский `TaskInfo[]`, як раніше) — стан `running` (у т.ч. від worktree) **вже** проставлений Rust'ом
- `findTasks(mtDir, deps)`: реалізувати поверх `scanTasks`/бінарника → `nodes.map(n => ({ dir: n.dir, relPath: n.path }))`. (Зберігається для публічного API в `index.js`.)
- `topoSort`, `areDepsResolved`, `getActiveWorktrees`, `parseWorktreeList` — **лишаються в JS без змін** (це граф-операції і git, не ФС-скан).

`deps` тепер: `{ binPath?, spawnSync? }` для тестованості (замість `readdirSync/existsSync/readFileSync`).

### 4.3 `npm/lib/core/state.mjs`

- **Видалити** `deriveNodeState` і `isComposite` (єдиний споживач — старий `scanner.mjs`) разом із їх приватними хелперами.
- **Зберегти** `sanitizeTaskName` (потрібен `worktree.mjs` для **створення** worktree в `mt run`) і `NODE_STATES` (канонічний перелік станів для валідації/відображення).
- ⚠️ Конвенція `sanitizeTaskName` тепер **дублюється**: JS-копія створює імена worktree (`mt run`), Rust-порт матчить їх при детекції `running` (§5). Обидві мають лишатися синхронними — закріпити спільними тест-векторами (ті самі входи/виходи в JS-тесті й Rust-тесті).

### 4.4 Споживачі (`scan/status/run/invalidate/watch/kill`)

Сигнатура `scanTasks` не змінюється → **виклики лишаються коректними**. Прибрати з 6 call-site'ів тепер-мертві `{ readdirSync, existsSync, readFileSync }` у `deps` (косметика, не обов'язково для функціональності). `run.mjs` далі читає `n.dir` — поле забезпечене адаптером.

### 4.5 `npm/index.js`

Експорти не змінюються (`findTasks`, `getActiveWorktrees`, `parseWorktreeList`). За потреби синхронізувати `version`.

## 5. Worktree → running (переноситься в Rust — за принципом §0)

Стан `running` від активного worktree — це деривація стану на основі ФС/git, тож за директивою «вся робота з ФС → Rust» вона **повністю переноситься в `mt-scanner`**. JS більше не робить тут нічого.

### 5.1 Зміни в Rust CLI

- `mt-scanner scan <tasks_dir> [--worktrees <comma-list>]`:
  - Якщо `--worktrees` **заданий** — використати цей список (детермінований вхід для тестів).
  - Якщо **не** заданий — Rust сам виявляє активні worktree: `git worktree list --porcelain` (через `std::process::Command`) із кореня репо, що містить `tasks_dir`; парсинг ідентичний поточному JS `parseWorktreeList` (останній компонент шляху кожного `worktree`-рядка).
- Порт `sanitizeTaskName` у Rust (точна копія JS-конвенції; синхронність — спільними тест-векторами, §4.3).

### 5.2 Логіка детекції (всередині `detect_state`/пост-процесу Rust)

Повторює пріоритет зі специфікації станів. Вузол підвищується до `Running`, якщо існує активний worktree, чия назва починається з sanitized-шляху:

```
running, якщо node.state ∈ {PlanReview, Spawned, Waiting, Blocked, Pending, Unassigned, Failed}
         і  ∃ wt ∈ worktrees: wt.starts_with(sanitize(node.path.replace('/', "-")))
```

Не чіпає вищі за пріоритетом стани (`PendingAudit`, `Resolved`, `Unresolvable`, вже-`Running` через sentinel). Інтегрується в наявний `apply_blocked`-прохід (обидва — пост-процеси над зібраним деревом).

### 5.3 Наслідки для JS

- `scanner.getActiveWorktrees`/`parseWorktreeList` більше **не потрібні для скану**. Залишити їх лише якщо їх використовує path створення worktree (`mt run`); інакше — видалити з публічного експорту. Уточнити на кроці §8.5.
- `activeWorktrees`-параметр `scanTasks` прокидується в `--worktrees`, коли непорожній (команди вже його обчислюють через `listActiveWorktrees`); інакше Rust сам discovery. Чисте FS-сканування лишається повністю в Rust.

## 6. Доставка бінарника

### 6.1 Структура платформного підпакета

```
packages/mt-darwin-arm64/
  package.json   { "name":"@7n/mt-darwin-arm64", "version":"<lockstep>",
                   "os":["darwin"], "cpu":["arm64"], "files":["mt-scanner"] }
  mt-scanner     (виконуваний бінарник, chmod +x)
packages/mt-linux-x64/
  package.json   { "name":"@7n/mt-linux-x64", "version":"<lockstep>",
                   "os":["linux"], "cpu":["x64"], "files":["mt-scanner"] }   // без libc
  mt-scanner
```

Версія підпакетів — **lockstep** з `@7n/mt` (публікуються разом).

### 6.2 `npm/package.json`

```json
"optionalDependencies": {
  "@7n/mt-darwin-arm64": "<same-as-@7n/mt>",
  "@7n/mt-linux-x64": "<same-as-@7n/mt>"
}
```

`files` головного пакета бінарника **не** містить.

### 6.3 CI — розширення `.github/workflows/npm-publish.yml`

Поточний workflow однопакетний (`@nitra/cursor release` + `JS-DevTools/npm-publish` на `npm/package.json`). Розширення:

Tooling — **`cargo-zigbuild`** (рішення §9.2): один Linux-раннер крос-збирає всі Linux/musl-таргети, легке додавання `linux-arm64` потім без нових тулчейнів.

- **build-matrix** (перед publish):
  - job `macos-14` (arm64): `cargo build --release --target aarch64-apple-darwin` (native, без zig) → artifact `mt-scanner` для `darwin-arm64`.
  - job `ubuntu-latest`: встановити `zig` + `cargo-zigbuild` + `rustup target add x86_64-unknown-linux-musl` → `cargo zigbuild --release --target x86_64-unknown-linux-musl` → artifact для `linux-x64`. (Майбутній arm64: той самий job + `--target aarch64-unknown-linux-musl`.)
- **assemble**: розкласти бінарники у `packages/mt-<key>/`, проставити версію (lockstep з результатом release-кроку).
- **publish**: спершу обидва платформні підпакети (`npm publish --access public --provenance`), потім головний `@7n/mt` (його optionalDependencies вже вказують на щойно опубліковані версії).
- Тригер `paths: npm/**` доповнити `scanner/**` (зміна Rust → перепублікація).

### 6.4 `target/` лишається в `.gitignore`

Бінарники в git не комітяться; для dev — `cargo build --release` + fallback резолвера (§4.1, крок 3).

### 6.5 Розширення на нові платформи (Windows / linux-arm64 / Intel Mac) — пізніше, add-only

Архітектура масштабується додаванням рядків, **без зміни логіки**:

- **linux-arm64**: `+ packages/mt-linux-arm64` (`aarch64-unknown-linux-musl`, без `libc`) + CI-job (з `cargo-zigbuild` — без нового тулчейну).
- **darwin-x64** (Intel Mac): `+ packages/mt-darwin-x64` + native `macos-13` job.
- **Windows**: `+ packages/mt-win32-x64` (`x86_64-pc-windows-msvc`, бінарник `mt-scanner.exe`) + **окремий native `windows-latest` job** (MSVC не йде через zigbuild — ортогонально до вибору musl-tooling). Path-логіка Rust уже портабельна (нормалізація `\`→`/`, `.lines()` ковтає `\r\n`); резолвер уже знає про `.exe` (§4.1). Потрібне лише фактичне тестування worktree-матчингу й `git worktree list` на Windows-runner.

У кожному випадку: новий підпакет + рядок в `optionalDependencies` + CI-job. JS/Rust-код не змінюється.

## 7. Тести

| Файл                           | Вплив                                                                    | Дія                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm/lib/tests/state.test.mjs` | блоки `deriveNodeState — *` і `isComposite` тестують видалену логіку     | видалити ці блоки; лишити тести `sanitizeTaskName`/`NODE_STATES`                                                                                                                                               |
| `npm/lib/tests/run.test.mjs`   | інжектить віртуальну ФС у `scanTasks` — DI більше не керує сканом        | переписати: реальні tmp-дерева задач + збілджений бінарник (`MT_SCANNER_BIN`), або мок шима через `deps.spawnSync`                                                                                             |
| `scanner/src/*`                | **нуль `#[test]`** — після видалення JS зникає покриття деривації станів | **додати Rust unit-тести** на `detect_state`/`apply_blocked`/`read_deps_dir`/`parse_frontmatter`/**worktree→running (§5)**/`sanitize` (спільні вектори з JS), що відтворюють кейси зі старого `state.test.mjs` |
| решта команд-тестів            | через `scanTasks`                                                        | де покладаються на віртуальну ФС — мокати `deps.spawnSync` або tmp-дерева                                                                                                                                      |

**Vitest global-setup:** один раз збілдити бінарник (`cargo build --release`) і виставити `MT_SCANNER_BIN`, щоб тести команд бачили реальний скан.

**Coverage/mutation gate:** JS-поверхня скорочується; деривація станів більше не під JS-mutation. Перенести гарантії в Rust-тести (`cargo test`); за потреби — додати `cargo test` у CI-гейт.

## 8. Кроки впровадження (порядок)

1. **Rust CLI** — додати в `scanner/src/`: `--worktrees` опцію, self-discovery worktree (`git worktree list --porcelain`), порт `sanitize`, інтеграцію worktree→running у пост-процес (§5).
2. **Rust-тести** — `#[test]` у `scanner/src/lib.rs` (кейси `state.test.mjs` + worktree→running + sanitize-вектори). `cargo test` зелений.
3. **Резолвер** — `npm/lib/core/scanner-bin.mjs` + unit-тест (env override, dev-fallback, помилка).
4. **Шим** — переписати `scanner.mjs` (flatten + мапінг §3, **без** worktree-логіки — вона в Rust), зберегти сигнатуру/експорти.
5. **state.mjs** — видалити `deriveNodeState`/`isComposite`; зберегти `sanitizeTaskName`/`NODE_STATES`; підчистити `state.test.mjs`.
6. **Споживачі** — прибрати мертві fs-`deps` (косметика); переконатися, що `run.mjs` бачить `n.dir`; вирішити долю `getActiveWorktrees`/`parseWorktreeList` (§5.3).
7. **Тести команд** — global-setup з `MT_SCANNER_BIN`; переписати `run.test.mjs`.
8. **Доставка** — `packages/mt-darwin-arm64`, `packages/mt-linux-x64`; `optionalDependencies` у `npm/package.json`.
9. **CI** — build-matrix + assemble + ordered publish у `npm-publish.yml`; тригер `npm/**` + `scanner/**`.
10. **Lint/coverage** — `bun run lint`, `vitest run`, `cargo test` зелені; ADR-нотатка про фінальне рішення (2 пакети, FS→Rust).

## 9. Відкриті питання

1. ~~worktree→running~~ — **вирішено**: переноситься в Rust (§5), за принципом «вся ФС-робота → Rust».
2. ~~CI tooling для musl~~ — **вирішено: `cargo-zigbuild`** (§6.3). Один Linux-раннер, дешеве додавання linux-arm64 потім.
3. **Версіонування підпакетів** — підтверджено lockstep з `@7n/mt`.
4. **`mt-scanner workspaces`** — друга підкоманда бінарника; чи має JS її теж викликати замість JS-discovery? **Відкладено за рішенням користувача — після цього рефакторингу.**

## 10. Ризики

- **Старт-латентність**: `spawnSync` бінарника на кожен скан + внутрішній `git worktree list` у Rust (коли `--worktrees` не передано). Для CLI прийнятно; якщо `watch` сканує часто — розглянути кеш/довгоживучий процес або передачу `--worktrees` (поза scope).
- **Платформний розрив**: на непокритій платформі (Intel Mac / linux-arm64 / Windows) CLI впаде без `MT_SCANNER_BIN`. Помилка резолвера має це чітко повідомляти (§4.1).
- **Дрейф семантики**: маючи єдину реалізацію в Rust, будь-яка зміна станів вимагає Rust-тестів — JS більше не страхує.
