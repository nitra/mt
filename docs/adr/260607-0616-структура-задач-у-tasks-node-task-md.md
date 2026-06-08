---
session: bce336cc-aa1a-406e-9d06-59ac3091f37c
captured: 2026-06-07T06:16:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/bce336cc-aa1a-406e-9d06-59ac3091f37c.jsonl
---

(no substantive decisions in the transcript)
---

## ADR Структура задач у `tasks/<node>/task.md`

## Context and Problem Statement
У проєкті `nitra/cursor` не існувало директорії `tasks/`. Користувач вирішив реалізувати зберігання задач через файлову систему відповідно до архітектури, описаної в `npm/docs/mt.md` (рекурсивний складений ОАГ з файловим сховищем стану).

## Considered Options
* Файлове сховище задач у `tasks/<node>/task.md` згідно з `npm/docs/mt.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Файлове сховище задач у `tasks/<node>/task.md`", because архітектура в `npm/docs/mt.md` визначає: кожен вузол — окрема директорія, стан вузла визначається наявністю файлів (`task.md` → `waiting`, `run_*.md` → `running`, `outputs_*.md` → `resolved`).

### Consequences
* Good, because transcript фіксує очікувану користь: можна запускати задачі через `mt run tasks/<name>` без додаткової конфігурації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Створені вузли:
- `tasks/ui-task-view/task.md` — UI перегляд задач, budget 3600 сек
- `tasks/coverage-skill-test/task.md` — тестування `n-coverage-fix` після міграції на `pi`, budget 1800 сек
- `tasks/skills-orchestrator-migration/task.md` — міграція скілів `npm/skills/` на JS-orchestrator паттерн, budget 7200 сек

Команда запуску: `mt run tasks/<node-name>`

---

## ADR Вибір назви UI-проєкту для графу задач

## Context and Problem Statement
Користувач вирішив реалізувати окремий UI-проєкт для перегляду задач і циклу виконання (описаних у `npm/docs/mt.md`) і запитав про варіанти назви.

## Considered Options
* `n-graph` — коротко, вписується в `n-cursor` ecosystem
* `graphwatch` — graph + watch (термін із `npm/docs/mt.md`)
* `taskflow` — product-орієнтована назва

## Decision Outcome
Chosen option: "`n-graph`" (рекомендований асистентом варіант, явного підтвердження вибору в transcript немає), because коротко, логічно пов'язано з `mt`, не прив'язано до конкретної технології реалізації.

### Consequences
* Good, because назва вписується в існуючу конвенцію іменування `n-*` пакетів у монорепо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Додаткової інформації в transcript не зафіксовано.
