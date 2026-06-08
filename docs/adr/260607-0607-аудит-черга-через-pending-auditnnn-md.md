---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:07:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Все збалансовано. Рухаємось до **B — рефакторинг `flow`**.

Нагадую scope B:
- Видалити: `mt init`, `mt init`, `mt audit`, `mt verify`, `mt run`, `mt run`, `mt kill`, `mt invalidate`, `mt done`
- Переосмислити: `mt plan` (Stage 1, з `plan_001.md`)
- Посилити: `mt verify` (читає `## Done when` + `outputs_NNN.md` + git diff)
- Оновити: `n-flow.mdc` (новий контракт)

Починаємо?
[user]
так
---
[/TRANSCRIPT]

---

Please generate the ADR(s) now based on the transcript above.

## ADR Аудит-черга через `pending-audit_NNN.md`

## Context and Problem Statement
Потрібно визначити механізм запуску аудитора після того, як агент завершує роботу над вузлом DAG. Існуючий дизайн передбачав синхронний запуск аудитора безпосередньо через wrapper-скрипт, але система мала перейти до нового контракту на основі файлів (`tasks/`).

## Considered Options
* Синхронний запуск аудитора wrapper-скриптом (старий підхід — `mt audit` → auditor у тому ж worktree одразу)
* Асинхронна черга через файл `pending-audit_NNN.md` (новий підхід — `mt audit` записує файл, `mt watch` підхоплює)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Асинхронна черга через `pending-audit_NNN.md`", because аудит має бути обробленим чергою (як скан файлів), а не синхронно в wrapper-скрипті — це відповідає загальному принципу «стан = файли» і дає `mt watch` єдину точку відповідальності за dispatch.

### Consequences
* Good, because transcript фіксує очікувану користь: `mt watch` отримує єдину точку управління чергою аудиту та виконання вузлів — без синхронних блокувань у wrapper.
* Good, because NNN у `pending-audit_NNN.md` дорівнює NNN відповідного `outputs_NNN.md` — ім'я файлу саме по собі є посиланням, без потреби у явному полі `ref:`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл: `tasks/<node>/pending-audit_NNN.md` (numbered, immutable; NNN = NNN з `outputs_NNN.md`)
- Front-matter: `created_at`, `outputs_ref`, `actor`
- Варіант нумерації: B (numbered, не overwrite) — обраний явно в transcript
- При повторному аудиті після доробки: агент пише `outputs_002.md` → `pending-audit_002.md`
- `mt watch` сканує вузли зі станом `pending-audit` і spawns auditor-агента
- Стан `pending-audit`: присутній `pending-audit_NNN.md` без відповідного `run_NNN.md` від auditor
- Ліміт циклів аудиту: 3 поспіль `actor: auditor, result: failed` → `mt watch` репортить проблему людині
- Зафіксовано в `npm/docs/mt.md` (секції «Аудитор (асинхронна черга)» і «Файловий контракт вузла»)

---

## ADR Переосмислення `mt plan` як Stage 1 (spec + decompose)

## Context and Problem Statement
Існуючий `mt` мав окремі команди `mt init` (brainstorm, панель персон) і `mt plan` (декомпозиція → MT file-presence state). При переході до архітектури npm/docs/mt.md потрібно було визначити, як ці команди живуть у новій двоетапній моделі виконання вузла.

## Considered Options
* Два кроки: `mt init` (design) → `mt plan` (decompose) — людина може зупинитись між ними
* Один крок: `mt plan` поєднує spec і decompose разом

## Decision Outcome
Chosen option: "Один крок: `mt plan` поєднує spec і decompose", because підтримувати два окремі кроки надлишково — design і decomposition природно об'єднуються в один акт планування.

### Consequences
* Good, because transcript фіксує очікувану користь: спрощений протокол агента — один виклик замість двох.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `mt init` — видалено, поглинуто в `mt plan`
- `mt plan` → вихід: `plan_001.md` (atomic path) або дочірні `task.md` (composite path)
- `plan_001.md` формат: YAML front-matter (`stage`, `created_at`, `path: atomic|composite`) + секції `## Аналіз`, `## Plan`, `## Sub-tasks`
- Режим визначається атрибутом `mode` у `task.md`: `human` (default, інтерактивний діалог) або `agent` (автономно)
- `mode: human` після Stage 1 → стан `plan-pending` (агент виходить, чекає людину)
- `mode: agent` → одразу Stage 2
- `mt plan` **не** викликає `mt spawn` автоматично — агент робить це явно (Варіант B)
- Зафіксовано в `npm/docs/mt.md` (секція «Інтеграція з `mt`»)

---

## ADR Видалення Фасаду B (`mt run/resume/cancel/repair`) та інших застарілих команд

## Context and Problem Statement
Існуючий `mt` мав Фасад B — повний автономний 5-фазний цикл (`mt run`, `mt run`, `mt kill`, `mt invalidate`) і ряд інших команд (`mt init`, `mt done`, `mt audit`, `mt verify`). При переході до архітектури npm/docs/mt.md потрібно було визначити долю кожної команди.

## Considered Options
* Зберегти Фасад B поряд з новою системою
* Видалити Фасад B повністю, замінивши на `graph`-команди

## Decision Outcome
Chosen option: "Видалити Фасад B повністю", because стан тепер зберігається у файлах (не в MT file-presence state), тому resume і repair стають зайвими; `mt run` і `mt kill` замінюють `mt run` і `mt kill`; весь Фасад B стає дублюванням.

### Consequences
* Good, because transcript фіксує очікувану користь: усувається дублювання між Фасадом B і `graph`-командами; MT file-presence state і `docs/specs/`, `docs/plans/` зникають.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Повна таблиця видалених команд:

| Команда | Замінник |
|---|---|
| `mt init` | worktree створює `mt run` |
| `mt init` | поглинуто в `mt plan` |
| `mt run` | `mt run` |
| `mt kill` | `mt kill` |
| `mt run` | не потрібно (state у файлах) |
| `mt invalidate` | не потрібно (state у файлах) |
| `mt audit` | аудит-черга через `pending-audit_NNN.md` |
| `mt verify` | `mt verify` |
| `mt done` | `mt done` / `mt audit` / `mt failed` |

- Видалено також: MT file-presence state, `docs/specs/`, `docs/plans/`
- Зафіксовано в `npm/docs/mt.md` (секція «Команди `flow` (нова таблиця)»)

---

## ADR Контракт `mt verify`: вхідні дані — `outputs_NNN.md` + git diff

## Context and Problem Statement
Стара `mt verify` перевіряла кроки зі стану MT file-presence state. При переході до нової архітектури MT file-presence state зникає, і потрібно було визначити що саме перевіряє `mt verify` і які дані вона отримує на вхід.

## Considered Options
* Тільки `outputs_NNN.md` — агент описує результат у файлі, verify перевіряє лише опис
* Тільки git diff worktree — перевіряє реальні зміни в коді
* `outputs_NNN.md` + git diff worktree — комбінація обох

## Decision Outcome
Chosen option: "`outputs_NNN.md` + git diff worktree (Option C)", because комбінація дає і самоопис агента (що він зробив), і реальні зміни в коді — повніший контекст для перевірки.

### Consequences
* Good, because transcript фіксує очікувану користь: verify має як опис агента, так і факт змін — точніша перевірка `## Done when`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `mt verify` читає: `task.md ## Done when` + `outputs_NNN.md` + `git diff` worktree + `plan_001.md`
- Реалізація: окремий LLM-процес з інструментами `run_command(cmd)` і `flow_audit(criterion, files)`
- Записує: `verify_001.md` (numbered)
- Exit code: `0=PASS`, `1=FAIL`
- Після verify: виконавець-агент читає результат → `mt done | mt audit | mt failed`
- Зафіксовано в `npm/docs/mt.md` (секція `mt verify — повний контракт`)
