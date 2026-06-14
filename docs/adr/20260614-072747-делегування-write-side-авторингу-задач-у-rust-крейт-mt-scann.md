---
session: 24f2af65-9582-4485-891b-8e797c410220
captured: 2026-06-14T07:27:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-mt/24f2af65-9582-4485-891b-8e797c410220.jsonl
---

## ADR Делегування write-side авторингу задач у Rust-крейт `mt-scanner`

## Context and Problem Statement

Проєкт дотримується принципу «усе, що стосується роботи з файловою системою, — в Rust». Read-side (сканування `task.md`) вже реалізовано в `mt-scanner scan`. Write-side (створення `task.md`, прапорів `a.md`/`h.md`, `deps/<id>.md`) лишався в JS-коді `npm/lib/commands/init.mjs` з прямими `mkdir`/`writeFile` та `buildTaskFrontMatter`.

## Considered Options

* Перенести авторинг у Rust-крейт `mt-scanner` (`create` subcommand), зробити `init.mjs` тонким шимом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Перенести авторинг у Rust-крейт `mt-scanner`", because це симетрично до read-side і відповідає принципу «FS — у Rust» (директива користувача, spec §2).

### Consequences

* Good, because transcript фіксує очікувану користь: атомарний запис (tmp+rename + rollback директорії при відкоті), ідемпотентність (`Exists` без перезапису), єдине місце валідації імені.
* Bad, because `init.mjs` тепер залежить від наявності скомпільованого `mt-scanner` бінарника (через `scanner-bin.mjs`); тести команди переписані з virtual-FS-патерну на `MT_SCANNER_BIN`+tmp.

## More Information

Змінені файли: `scanner/src/lib.rs` (`pub fn create_task`, `CreateOpts`, `CreateOutcome`, `Mode`), `scanner/src/main.rs` (підкоманда `create`, парсер прапорів), `npm/lib/commands/init.mjs` (тонкий шим через `spawnSync`), `scanner/Cargo.toml` (+`chrono`). Pub-типи мають `#[derive(Serialize, Deserialize)]` для майбутнього Tauri-binding у `/Users/vitalii/www/nitra/task`. Атомарність: `fs::create_dir_all` → tmp-файл → `fs::rename`; при помилці — rollback щойно створених директорій.

---

## ADR Формат файлів-прапорів `a.md` і `h.md` — markdown із секціями

## Context and Problem Statement

При створенні задачі `mt-scanner create` має записати файл-прапор виконавця: `a.md` (agent-режим) або `h.md` (human-режим). Треба було обрати формат файлу, сумісний із майбутнім парсингом у `run.mjs` та `tauri::command`.

## Considered Options

* Markdown із іменованими секціями (`## Model tier`, `## Skills`, `## Qualification`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Markdown із іменованими секціями", because користувач явно обрав «markdown з секціями» (відповідь на відкрите питання формату `a.md`/`h.md`).

### Consequences

* Good, because transcript фіксує очікувану користь: `run.mjs` читає `model_tier` із секції `## Model tier` в `a.md`; формат людино-читабельний і forward-compatible (нові секції додаються без схема-міграції).
* Bad, because `run.mjs` потребує рядкового парсингу markdown-секцій замість структурованого YAML; transcript не містить підтверджених негативних наслідків щодо крихкості парсера.

## More Information

`a.md` містить секції `## Model tier` (значення tier) і `## Skills` (список). `h.md` — секцію `## Qualification` (вільний опис у placeholder при створенні). Парсинг у `run.mjs`: функція `resolveExecutor` читає `a.md` і витягує `model_tier` з рядка після `## Model tier`; fallback — старий `executor` у frontmatter → `default_model_tier` з `.mt.json`.

---

## ADR `validate_name` відхиляє (не sanitize) + спільні тест-вектори Rust↔JS

## Context and Problem Statement

Існуюча функція `sanitizeTaskName` у `npm/lib/core/state.mjs` **замінює** неприпустимі символи на `-` (дозволяє uppercase, `_`, пробіли). Специфікація §8 вимагає **відхиляти** імена з такими символами (exit 2). Треба обрати, розширити `sanitize` чи створити окрему функцію; і як синхронізувати правила між Rust і JS.

## Considered Options

* Нова функція `validate_name` (Rust) / `validateTaskName` (JS), яка **відхиляє** невалідні імена — існуючий `sanitize` лишається незмінним
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Нова функція validate_name / validateTaskName, що відхиляє", because `sanitize` вже використовується у worktree-matching з іншою семантикою; об'єднання зламало б наявні виклики.

### Consequences

* Good, because transcript фіксує очікувану користь: правила перевіряються в одному місці (Rust); спільний fixture `npm/lib/tests/fixtures/name-vectors.json` гарантує синхронність між реалізаціями.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — дві функції з подібними назвами потребують уваги при онбордингу.

## More Information

Правила (spec §8): сегменти `[a-z0-9-]+`, без uppercase/`_`/пробілів, без `..`/`.`, без провідного або завершального `/`, без `//`. Файл спільних векторів: `npm/lib/tests/fixtures/name-vectors.json` — споживається Rust-тестами через `include_str!` і JS-тестами в `init.test.mjs`. Існуючий `sanitize` у `scanner/src/lib.rs:183` не змінювався.

---

## ADR Джерело істини для `model_tier` при запуску задачі — файл `a.md`

## Context and Problem Statement

До введення write-side `run.mjs` брав `model_tier` виключно з `executor.model_tier` у frontmatter `task.md`. Нова специфікація §2.6 прибирає `executor` з frontmatter і переносить tier у прапор `a.md`. Без змін у `run.mjs` задачі, створені через `mt-scanner create --model-tier MAX`, мовчки відкочувались би до `AVG` при запуску.

## Considered Options

* Варіант A: `run.mjs` читає `model_tier` із секції `## Model tier` в `a.md`; fallback на `executor` у frontmatter (сумісність зі старими вузлами) → `default_model_tier` з `.mt.json`
* Варіант B: лишити поза scope цієї задачі, прийняти тихе падіння tier до окремої спеки

## Decision Outcome

Chosen option: "Варіант A", because користувач підтвердив варіант A після того, як асистент назвав Варіант B «мовчазною втратою MAX».

### Consequences

* Good, because transcript фіксує очікувану користь: `--model-tier MAX` при `create` зберігається і застосовується при `run`; зворотна сумісність зі старими вузлами через fallback-ланцюг.
* Bad, because `run.mjs` ускладнився: додано функцію `resolveExecutor` із трьома рівнями fallback; cognitive complexity функції `runOne` зросла з 23 до 23 (пре-існуюче попередження, не регресія від цієї зміни).

## More Information

Реалізовано в `npm/lib/commands/run.mjs`: функція `resolveExecutor(taskDir, fm, config, deps)` — читає `a.md` через `deps.readFile`, парсить секцію `## Model tier`; при відсутності `a.md` або секції — fallback на `fm.executor.model_tier ?? config.default_model_tier`.
