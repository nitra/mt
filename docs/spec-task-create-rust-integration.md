# Специфікація: створення задач через Rust (`mt-scanner create`)

Статус: **погоджено — готово до реалізації** (рішення §2; §12 закрито)
Дата: 2026-06-13

> **Принцип (директива користувача):** *усе, що стосується роботи з файловою системою, має бути в Rust.* Симетрично до скану (читання), **створення** задачі — теж ФС-операція (mkdir + запис `task.md` + прапор `a.md`/`h.md` + `deps/`), тож її реалізація переноситься в крейт `mt-scanner`. JS-команда `mt init` стає тонким шимом, що викликає бінарник і парсить JSON; `task` Tauri-застосунок викликає **ту саму** крейт-функцію напряму.

Пов'язані документи: `docs/spec-scanner-rust-integration.md` (read-side; цей документ — write-side counterpart), `docs/mt.md` (файловий контракт вузла).

## 1. Мета і scope

Перенести логіку створення нового вузла задачі з JS (`npm/lib/commands/init.mjs` + `buildTaskFrontMatter`) у крейт `mt-scanner`, який стає **єдиним джерелом істини** для авторингу `task.md` — так само, як він уже є джерелом істини для скану.

Одна реалізація, **три споживачі**:

1. **npm CLI** — `mt init <name>` через `spawnSync` бінарника (дзеркало того, як `scan` уже працює).
2. **Бінарник** — нова підкоманда `mt-scanner create`.
3. **`task` Tauri-застосунок** — новий command `create_task`, що викликає `mt_scanner::create_task(...)` напряму (застосунок уже лінкує крейт через `Cargo.toml`).

**Scope:** атомарне створення вузла з шаблонного контракту — `mt/<name>/task.md`, прапор виконавця (`a.md`/`h.md`), опційні `deps/<id>.md`. Без LLM, без git, без worktree.

**Поза scope:**

- `mt spawn` (матеріалізація composite-дітей із claim/worktree — це оркестрація, не просто авторинг ФС; окрема спека).
- Plan/run/audit-артефакти (`plan_NNN.md`, `run_NNN.md` тощо) — їх пишуть інші команди.
- Редагування наявних вузлів (`task.md` immutable після створення — §4.4).
- Windows (як і в scanner-спеці).

## 2. Зафіксовані рішення

1. **Реалізація в крейті** — `pub fn create_task(tasks_dir, name, opts) -> Result<CreateOutcome, String>` у `scanner/src/lib.rs`. Бінарник і Tauri-команда — тонкі обгортки над нею.
2. **Виклик із JS** — `spawnSync(bin, ['create', mtDir, name, ...flags], { encoding: 'utf8' })`, парсинг `stdout` як JSON. Контракт ідентичний `scan` (§3 scanner-спеки).
3. **Канонічний `task.md` генерує Rust** — і frontmatter, і тіло. JS більше не будує markdown для `init` (прибираємо `buildTaskFrontMatter` зі шляху init).
4. **Доставка бінарника без змін** — підкоманда не додає нових платформних артефактів; чинні `@7n/mt-darwin-arm64` / `@7n/mt-linux-x64` уже містять потрібний бінарник (тригер CI `scanner/**` уже перебілджує — §6.3 scanner-спеки).
5. **Ідемпотентність** — якщо `task.md` уже існує: не перезаписувати, повернути `{ created: false, reason: "exists" }`, exit `0` (як чинний `mt init`).
6. **Виконавець = прапор-файл** (рішення §12.1 = A) — `a.md`/`h.md` єдине джерело істини; дублі `mode`/`executor`/`interactive` у frontmatter **прибрано**.
7. **`deps` лише в директорії** `deps/<id>.md` (рішення §12.3) — поле `deps:` з frontmatter прибрано; `--dep` пише **порожній** файл-ребро.
8. **`schema_version` — лише нові файли** (рішення §12.2) — `create` завжди пише `schema_version: 1`; міграції наявних `task.md` не робимо.

## 3. Контракт CLI та бібліотеки

### 3.1 Підкоманда

```
mt-scanner create <tasks_dir> <name> [--mode agent|human]
                                     [--model-tier MIM|AVG|MAX]
                                     [--budget-sec N]
                                     [--hint <text>]
                                     [--dep <id>]...        # повторюваний
```

- `<tasks_dir>` — корінь `mt/` (як у `scan`).
- `<name>` — id вузла; може містити `/` для вкладених (`research/collect-data`). Валідація — §8.
- Прапорці мапляться на поля frontmatter / прапор виконавця (§4).

### 3.2 Вихід (stdout, JSON)

```jsonc
// створено
{ "created": true,  "name": "research/collect-data",
  "task_path": "research/collect-data/task.md",     // відносний від tasks_dir
  "flag": "h.md",
  "deps": ["collect-data"] }
// вже існувало
{ "created": false, "reason": "exists", "name": "...", "task_path": "..." }
```

- Помилка (невалідне ім'я, відмова ФС) → `eprintln!` + `process::exit(2)` (як `scan`). JS-шим кидає `Error`.
- `bin` додає `create` до `usage()`; гілка `match` дзеркалить `scan`.

### 3.3 Бібліотечна сигнатура (для Tauri)

```rust
pub struct CreateOpts {
    pub mode: Mode,                  // Agent | Human (default per .mt.json default_mode)
    pub model_tier: Option<String>,  // MIM|AVG|MAX
    pub budget_sec: Option<u64>,
    pub hint: Option<String>,
    pub deps: Vec<String>,
}
pub enum CreateOutcome { Created { .. }, Exists { .. } }
pub fn create_task(tasks_dir: String, name: String, opts: CreateOpts) -> Result<CreateOutcome, String>;
```

Defaults беруться з `.mt.json` (`default_mode`, `default_model_tier`, `default_budget_sec`) — Rust уже читає цей конфіг для скану; той самий resolver.

## 4. Канонічний `task.md` — джерело істини в Rust

### 4.1 Frontmatter

```yaml
---
schema_version: 1            # ПЕРШЕ поле (інваріант docs/mt.md); лише нові файли (§2.8)
created_at: <ISO-8601>
budget_sec: 600              # або --budget-sec / .mt.json default_budget_sec
hint: atomic                 # або --hint
---
```

Свідомо **немає** полів `mode`/`executor`/`interactive` (істина = прапор `a.md`/`h.md`, §2.6) і `deps:` (істина = директорія `deps/`, §2.7).

### 4.2 Тіло (зберігаємо чинний шаблон init)

```markdown
## Mission

<!-- Опишіть завдання тут -->

## Done when

<!-- Критерії успіху -->

## Context

<!-- Додатковий контекст для виконавця -->
```

### 4.3 Прапор виконавця — `a.md` / `h.md`

За `docs/mt.md` **хто** виконує визначає прапор-файл, а не поле frontmatter. Сканер деривує стан саме з них (`Pending` ⇐ `h.md`, `Waiting` ⇐ `a.md`). Тому `create`:

- `--mode human` → створює `h.md` (порожній або з `qualification`);
- `--mode agent`  → створює `a.md` (з `model_tier`, `skills`);
- **ніколи обидва**.

⚠️ Це виправляє чинну ваду: `mt init` пише `mode: human` у frontmatter, але **не** створює `h.md` → свіжа задача сканується як `Unassigned` замість `Pending`. Після цієї спеки create пише прапор → стан коректний одразу. Поля `mode`/`executor`/`interactive` із frontmatter прибрано — прапор єдине джерело (§2.6).

### 4.4 Залежності — лише `deps/`

`--dep <id>` пише **порожній** `deps/<id>.md` (топологічне ребро). `ref:`-вміст (data-flow на конкретний `fact_NNN.md`) дописується **пізніше**, коли деп resolved — на create факт-файлів ще не існує, тож `ref:` був би dangling. Поле `deps:` у frontmatter не пишемо (§2.7). Сканер уже читає ребра саме з `deps/`.

### 4.5 Immutability

`task.md` immutable після створення (`docs/mt.md`). `create` ніколи не перезаписує наявний (§2.5). Прапор (`a.md`/`h.md`) — мутабельний, але `create` його теж не чіпає, якщо вузол уже існує.

## 5. Цільова архітектура

```
                       ┌────────────────────────────────────────┐
                       │  mt-scanner крейт (scanner/src/lib.rs)   │
                       │  pub fn create_task(...) ── ЄДИНА логіка │
                       └────────────────────────────────────────┘
            ▲ напряму (Cargo dep)        ▲ обгортка bin            ▲ spawnSync bin
   ┌────────┴─────────┐      ┌───────────┴──────────┐   ┌──────────┴───────────┐
   │ task Tauri app   │      │ mt-scanner create     │   │ @7n/mt: mt init <n>  │
   │ command create_  │      │ (CLI, JSON out)       │   │ (тонкий JS-шим)      │
   │ task → invoke    │      └───────────────────────┘   └──────────────────────┘
   └──────────────────┘
```

Симетрія з read-side: `scan_tasks` (lib) ← `mt-scanner scan` (bin) ← `scanner.mjs` (шим) ← Tauri `scan_tasks`.

## 6. JS-шим (`npm/lib/commands/init.mjs`)

- Переписати на: резолвити бінарник (`scanner-bin.mjs`, уже існує з read-спеки) → `spawnSync(bin, ['create', mtDir, name, ...flags])` → parse JSON → лог за полем `created`.
- **Зберегти** публічну сигнатуру `mt init <name>` і exit-коди (0 створено/існує, 1 usage/помилка аргументів).
- Прибрати `buildTaskFrontMatter` і прямі `writeFileSync/mkdirSync` зі шляху init (логіка тепер у Rust).
- `mtDir` резолвиться як і раніше (`resolveMtDir(loadConfig(...))`), передається бінарнику аргументом.

## 7. Інтеграція в `task` (Tauri)

- `app/src-tauri/src/lib.rs`: додати
  ```rust
  #[tauri::command]
  fn create_task(tasks_dir: String, name: String, opts: CreateOpts) -> Result<CreateOutcome, String> {
      mt_scanner::create_task(tasks_dir, name, opts)
  }
  ```
  і зареєструвати в `generate_handler![... create_task]`.
- Застосунок **уже** залежить від крейта (`mt-scanner = { git = ... }`, patch на локальний шлях) → жодного нового рантайму, бінарник не потрібен.
- Фронт (окрема `task`-side спека за n-flow, `docs/specs/`): кнопка «+», форма (name + mode + опційні поля) → `invoke('create_task', ...)` → `scanAll()` для рефрешу. UI-частина поза цим документом — тут фіксуємо лише Rust-контракт, що його UI споживає.

## 8. Валідація імен (у Rust, єдине джерело)

За `docs/mt.md`: дозволені `a-z`, `0-9`, `-`; роздільник сегментів `/`; `-` всередині сегмента. `create` відхиляє:

- порожнє ім'я / порожній сегмент (`a//b`, провідний/кінцевий `/`);
- символи поза `[a-z0-9-/]`; великі літери; пробіли;
- `..` / абсолютні шляхи (захист від traversal поза `tasks_dir`).

Помилка валідації → exit `2` + зрозуміле повідомлення. (Чинний JS init **не** валідує — це додає гарантію.)

## 9. Доставка

Без змін відносно scanner-спеки: підкоманда вшита в той самий бінарник; платформні підпакети та CI-тригер `scanner/**` уже покривають перебілд. Нових `optionalDependencies` не треба.

## 10. Тести

| Рівень | Дія |
|---|---|
| Rust unit (`scanner/src/lib.rs`) | `create_task`: успіх (файли+прапор створено, frontmatter коректний, `schema_version:1` перший), ідемпотентність (exists → не перезаписує), вкладені імена (`a/b/c` → рекурсивний mkdir), `--dep` пише `deps/<id>.md`, валідація (відхилення невалідних/traversal імен) |
| Rust ↔ JS вектори | спільні тест-вектори валідації імен (ті самі входи/виходи в Rust і в JS-тесті шима) — як `sanitize` у read-спеці |
| JS (`init.test.mjs`) | переписати з віртуальної ФС на `MT_SCANNER_BIN` + tmp-дерево (як `run.test.mjs` у read-спеці); перевірити парсинг JSON і exit-коди |
| Tauri (опц.) | smoke: `create_task` у tmp `tasks_dir` → файл існує |

Coverage/mutation-гарантії авторингу переносяться в `cargo test` (JS більше не страхує).

## 11. Кроки впровадження

1. **Rust lib** — `create_task` + `CreateOpts`/`CreateOutcome` + валідація імен + запис frontmatter (`schema_version`/`created_at`/`budget_sec`/`hint` — **без** `mode`/`executor`/`deps`) + прапор `a.md`/`h.md` + порожні `deps/<id>.md`.
2. **Rust-тести** — `#[test]` за таблицею §10. `cargo test` зелений.
3. **Bin** — гілка `create` у `main.rs` + рядок в `usage()`.
4. **JS-шим** — переписати `init.mjs` на `spawnSync` (юзає наявний `scanner-bin.mjs`); прибрати `buildTaskFrontMatter` зі шляху init.
5. **JS-тести** — переписати `init.test.mjs` на `MT_SCANNER_BIN`.
6. **Tauri** — `create_task` command у `task/app/src-tauri/src/lib.rs` + реєстрація.
7. **Lint/coverage** — `cargo test`, `vitest run`, `bun run lint` зелені; ADR-нотатка (write-side → Rust).

## 12. Рішення (закрито)

1. **Frontmatter-поля `mode`/`executor`/`interactive` → прибрано** (варіант A). Виконавця визначає прапор `a.md`/`h.md` — єдине джерело; сканер уже деривує стан із прапора.
2. **`schema_version` → лише нові файли.** `create` завжди пише `schema_version: 1`; міграції наявних `task.md` не робимо.
3. **`--dep` → порожній `deps/<id>.md`** (топологічне ребро). Поле `deps:` у frontmatter прибрано. `ref:`-вміст дописується пізніше, коли деп resolved (інакше dangling ref на неіснуючий `fact_NNN.md`).
4. **Поділ спек:** Rust-контракт — тут (mt-репо); UI «кнопка + форма» — окрема спека в `task` за n-flow (`task/docs/specs/<date>-add-task.md`).

## 13. Ризики

- **Дрейф frontmatter-контракту** між тим, що пише `create` (Rust), і тим, що читає `scan` (Rust) та парсить JS-frontmatter. Мітигація: обидва шляхи в одному крейті + спільні тест-вектори.
- **Старт-латентність** `spawnSync` на створення — для CLI прийнятно (рідка операція); Tauri викликає крейт напряму без spawn.
- **Path traversal** через `<name>` — закрито валідацією §8 (Rust, до будь-якого mkdir).
- **Часткова відмова** (mkdir ок, запис впав → порожня директорія). Мітигація: писати у tmp + atomic rename, або прибирати створену директорію при відкоті — зафіксувати на кроці §11.1.
