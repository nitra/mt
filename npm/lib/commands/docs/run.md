---
type: JS Module
title: run.mjs
resource: npm/lib/commands/run.mjs
docgen:
  crc: 074f6a8e
  model: omlx/gemma-4-e2b-it-4bit
  score: 95
---

## Огляд

Файл відповідає за запуск задачі через інструмент `mt run` з налаштованими параметрами та керування робочими директоріями.

Файл читає деталі завдання з `task.md`, включаючи `budget_sec`, `budget_hard_sec`, `deps`, `mode` та `executor`.

Перевіряє, чи всі `deps` розв'язані.

Обчислює `NNN` як кількість файлів `run_*.md` плюс одиниця.

Створює `worktree` у директорії `.worktrees/<task-epoch>/` з атомарним блокуванням за допомогою `atomic mkdir lock` (з обробкою `EEXIST = skip`).

Встановлює змінні середовища, включаючи `MT_RUN_NNN`, `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, та `MT_TASK_PATH`.

Запускає `subprocess`: вбудований `claude` CLI (actor=agent за замовчуванням) АБО, якщо `.mt.json` задає `node_executor`, зовнішню команду-екзекутор, якій MT делегує застосування змін (claim/lease/worktree/budget/`## Check`/publish лишаються за MT).

Після завершення `subprocess`, перевіряє наявність артефакту `fact_NNN.md` для визначення `result:success` або `result:failed`.

Записує артефакт `run_NNN.md` у відповідну директорію.

Якщо `result` дорівнює `success`, виконує `git merge` та видаляє створений `worktree`.

У режимі `--auto`, сканує для готових задач (`waiting` + `deps resolved`), клеймить атомарне створення `worktree`.

Перевіряє ліміт `max_worktrees`.

Сповіщає про кількість активних `worktrees`, якщо вони перевищують `warn_worktrees_above`.

Якщо `taskPath` не вказано, виводить інструкцію про використання аргументів.

Якщо `taskPath` вказано, перевіряє наявність `task.md` у директорії.

Перевіряє залежності для поточного завдання.

Якщо `actor` дорівнює `agent` або `a`, запускає `claude` у `worktree` з інструкціями про виконання.

Якщо `actor` дорівнює `human`, повідомляє про необхідність ручного виконання, але повертає `success`.

У разі помилок під час створення `worktree` або виконання, повертає помилку.

Якщо задача завершилася з помилкою, зберігає `worktree` для діагностики.

Якщо `result` дорівнює `success`, виконує `git merge` та видаляє `worktree`.

## Поведінка

Поведінка

1. Завантажує task.md для отримання `budget_sec`, `budget_hard_sec`, `deps`, `mode`, `executor`.
2. Перевіряє, чи всі `deps` розв'язані.
3. Обчислює `NNN` як кількість `run_*.md` плюс один.
4. Створює `worktree` у директорії `.worktrees/<task-epoch>/` з атомарним блокуванням.
5. Встановлює змінні середовища, включаючи `MT_RUN_NNN`, `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, `MT_TASK_PATH`.
6. Запускає `subprocess`: вбудований `claude` CLI (actor=agent за замовчуванням) АБО, якщо `.mt.json` задає `node_executor`, зовнішню команду-екзекутор, якій MT делегує застосування змін (claim/lease/worktree/budget/`## Check`/publish лишаються за MT).
7. Після завершення `subprocess`, перевіряє наявність `fact_NNN.md` для визначення `result:success` або `result:failed`.
8. Записує артефакт `run_NNN.md` у відповідну директорію.
9. Якщо `result` дорівнює `success`, виконує `git merge` та видаляє створений `worktree`.
10. У режимі `--auto`, сканує для готових задач (`waiting` + `deps resolved`), клеймить атомарне створення `worktree`.
11. Перевіряє ліміт `max_worktrees`.
12. Сповіщає про кількість активних `worktrees`, якщо вони перевищують `warn_worktrees_above`.
13. Якщо `taskPath` не вказано, виводить інструкцію про використання аргументів.
14. Якщо `taskPath` вказано, перевіряє наявність `task.md` у директорії.
15. Перевіряє залежності для поточного завдання.
16. Якщо `actor` дорівнює `agent` або `a`, запускає `claude` у `worktree` з інструкціями про виконання.
17. Якщо `actor` дорівнює `human`, повідомляє про необхідність ручного виконання, але повертає `success`.
18. У разі помилок під час створення `worktree` або виконання, повертає помилку.
19. Якщо задача завершилася з помилкою, зберігає `worktree` для діагностики.
20. Якщо `result` дорівнює `success`, виконує `git merge` та видаляє `worktree`.

## Retry ladder (MT_ATTEMPT)

Перед запуском `subprocess` рахує `attempt = failed_streak + 1`, де `failed_streak` — кількість `run_*.md` з `result: failed` після останнього прийнятого `fact_*.md` (та сама формула, що й у Rust `mt-core::failed_streak`). На основі `attempt` обирає стратегію та (з attempt 3) підвищує тир моделі на один щабель `MIM → AVG → MAX` відносно `executor.model_tier` з `task.md`:

- `attempt = 1` → `MT_RETRY_STRATEGY=baseline`, тир без змін.
- `attempt = 2` → `MT_RETRY_STRATEGY=diagnose-first`, тир без змін.
- `attempt ≥ 3` → `MT_RETRY_STRATEGY=alternative-approach`, тир підвищено на один щабель (стеля — `MAX`).

Результат (`MT_ATTEMPT`, `MT_RETRY_STRATEGY`, ескальований `MT_MODEL_TIER`) передається обома шляхами виконання: у `env` зовнішнього `node_executor` і у вбудований `claude` CLI шлях (де для attempt ≥ 2 додатково вставляється текстова підказка-ретрай у промпт).

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
