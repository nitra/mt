---
session: 24f2af65-9582-4485-891b-8e797c410220
captured: 2026-06-14T06:43:26+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-mt/24f2af65-9582-4485-891b-8e797c410220.jsonl
---

## ADR Делегування init.mjs у Rust-бінарник mt-scanner

## Context and Problem Statement
Команда `mt init` у JavaScript безпосередньо створювала файли задачі через `writeFile`/`mkdir`. Директива проєкту (spec §1) вимагає, щоб уся робота з файловою системою виконувалась у Rust — симетрично до вже перенесеного `scan`.

## Considered Options
* Зберегти пряме FS-запис у JS (`init.mjs` → `writeFile`/`mkdir`)
* Делегувати FS-роботу в `mt-scanner create` через `spawnSync`, `init.mjs` лише парсить JSON-відповідь

## Decision Outcome
Chosen option: "Делегувати в `mt-scanner create`", because директива користувача «усе, що стосується роботи з файловою системою, має бути в Rust» (spec §1) і паритет із вже існуючим шимом `scanner.mjs`/`scanner-bin.mjs` для `scan`.

### Consequences
* Good, because `init.mjs` зводиться до парсингу аргументів і виклику бінарника — вся логіка FS, валідація та атомарний запис живуть в одному місці (Rust).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/lib/commands/init.mjs` переписаний: викликає `spawnSync(bin, ['create', mtDir, name, ...flags])`, парсить JSON, обробляє exit-коди 0/1/2/3.
- `npm/lib/scanner-bin.mjs` (`resolveScanner`) — вже існуючий резолвер бінарника, перевикористаний без змін.

---

## ADR validate_name відхиляє некоректні імена замість sanitize

## Context and Problem Statement
Існуючий JS `sanitizeTaskName` і Rust `fn sanitize` **замінювали** недозволені символи на `-`, пропускаючи uppercase, `_`, пробіли, `..`. Специфікація §8 вимагає суворої **відмови** з exit-кодом 2, а не мовчазного виправлення.

## Considered Options
* Залишити підхід sanitize (заміна символів)
* Нова функція `validate_name` (відхиляє некоректні імена, повертає `Err`)

## Decision Outcome
Chosen option: "`validate_name` відхиляє", because spec §8 явно вимагає відхилення (uppercase, пробіли, `_`, `..`, traversal, порожні сегменти, > 100 символів) з exit-кодом 2.

### Consequences
* Good, because transcript фіксує очікувану користь: гарантована консистентність між Rust і JS через спільні тест-вектори; помилкові імена не потрапляють у файлову систему в спотвореному вигляді.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `scanner/src/lib.rs`: `pub fn validate_name(name: &str) -> bool` — перевіряє кожен сегмент: лише `[a-z0-9-]`, не порожній, не `..`, не починається з `/`, загальна довжина ≤ 100.
- Правила валідації відрізняються від старого `sanitizeTaskName` (той дозволяв `_` і uppercase).
- `main.rs`: гілка `create` повертає `process::exit(2)` при `Err` що починається з `"invalid name"`.

---

## ADR Спільні тест-вектори Rust↔JS у validate_vectors.json

## Context and Problem Statement
`validate_name` реалізована в Rust, але JS-шим і майбутній Tauri-клієнт мусять дотримуватись тих самих правил. Без спільного джерела тест-векторів правила можуть розійтись між реалізаціями.

## Considered Options
* Окремі незалежні набори тестів у Rust і JS
* Єдиний файл `scanner/tests/validate_vectors.json`, який читають і Rust-тести (`include_str!`), і JS-тести (`import ... with { type: "json" }`)

## Decision Outcome
Chosen option: "Єдиний `validate_vectors.json`", because потрібні «спільні тест-вектори Rust↔JS саме для validate» — так гарантується, що обидві сторони перевіряють одні й ті самі входи.

### Consequences
* Good, because transcript фіксує очікувану користь: додавання нового вектора в один файл автоматично покриває обидва test-suite.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `scanner/tests/validate_vectors.json`: структура `{ "valid": [...], "invalid": { "uppercase": [...], "spaces": [...], "underscore": [...], "double_dot": [...], "traversal": [...], "empty_segment": [...], "too_long": [...] } }`.
- Rust: `include_str!("../tests/validate_vectors.json")` у `mod create_tests`.
- JS: `import vectors from "../../scanner/tests/validate_vectors.json" with { type: "json" }` у `npm/tests/init.test.mjs`.

---

## ADR Атомарний запис задачі через tmp-dir + rename

## Context and Problem Statement
При збої посередині запису (диск повний, сигнал) задача могла б залишитись у напівзаписаному стані в `<tasks_dir>/<name>/`. Потрібен механізм, що або повністю створює задачу, або не залишає слідів.

## Considered Options
* Пряме покрокове створення файлів у фінальній директорії
* Запис у тимчасову директорію (`<name>.<uuid>.tmp`), потім `fs::rename` у фінальний шлях; при помилці — `remove_dir_all(tmp_dir)`

## Decision Outcome
Chosen option: "tmp-dir + rename", because `fs::rename` атомарна в межах одного filesystem, tmp-dir знаходиться в тому ж `tasks_dir` (гарантія одного disku).

### Consequences
* Good, because transcript фіксує очікувану користь: часткові записи не залишаються — або задача існує повністю, або не існує зовсім.
* Bad, because `fs::rename` атомарна лише в межах одного filesystem — transcript фіксує це як відомий ризик (tmp-dir у тому ж `tasks_dir` мінімізує, але не усуває повністю).

## More Information
- `scanner/src/lib.rs`, функція `create_task`: `tmp_name = format!("{}.{}.tmp", name.replace('/', "__"), Uuid::new_v4())`.
- При помилці в `write_task_files`: `let _ = fs::remove_dir_all(&tmp_dir)`.
- `uuid = { version = "1", features = ["v4"] }` додано до `scanner/Cargo.toml`.

---

## ADR Бібліотека chrono для ISO-8601 у created_at

## Context and Problem Statement
Поле `created_at` у `task.md` frontmatter мусить бути рядком ISO-8601. `scanner/Cargo.toml` не мав залежностей для форматування часу.

## Considered Options
* Ручне форматування через `std::time::SystemTime` (без нових залежностей)
* Крейт `chrono` з `Utc::now().to_rfc3339()`

## Decision Outcome
Chosen option: "`chrono`", because користувач підтвердив «chrono» як прийнятний варіант, а вбудоване форматування через `SystemTime` потребує ручного написання формату ISO-8601 і є джерелом помилок.

### Consequences
* Good, because `to_rfc3339()` гарантує коректний ISO-8601 без ручного форматування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `scanner/Cargo.toml`: `chrono = { version = "0.4", features = ["serde"] }`.
- Використання: `Utc::now().to_rfc3339()` у `write_task_files` → поле `created_at` у frontmatter `task.md`.
