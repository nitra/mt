---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-06T21:41:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

## ADR Реформування `flow` під архітектуру npm/docs/mt.md: `graph` як оркестратор, `flow` як внутрішній протокол вузла

## Context and Problem Statement
Існують дві паралельні системи: `mt` (ранній MT workflow: init/spec/plan/verify/release, стан у MT file-presence state і `docs/`) і нова архітектура `npm/docs/mt.md` (автономний ОАГ: `tasks/<node>/task.md`, file-based state, git worktree + post-merge hook). Вони перекриваються у worktree-lifecicle та концепції «кроків виконання», але мають несумісні формати і різні рівні автономії. Потрібно поєднати їх в єдину систему.

## Considered Options
* `graph` як оркестратор ззовні, `flow` як протокол всередині вузла (обраний варіант)
* Повне злиття: `mt init` = `mt init`, `mt done` = merge + cascade
* Зберегти обидві системи паралельно без злиття
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`graph` як зовнішній оркестратор, `flow` як внутрішній протокол вузла", because `graph` управляє worktree-lifecycle, залежностями, merge і каскадом, а `flow` обслуговує логіку одного запуску зсередини worktree — межа відповідальності чітка і не дублюється.

### Consequences
* Good, because transcript фіксує очікувану користь: `flow` стає легшим (зникають MT file-presence state, `docs/specs/`, `docs/plans/`), `graph` отримує повний контроль над станом та паралелізмом.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли що зникають: MT file-presence state, `docs/specs/`, `docs/plans/`. Нові артефакти: `task.md`, `plan_001.md`, `outputs_NNN.md`. Команди `mt init` і `mt init` видаляються; `mt done` замінюється на `mt done|audit|failed`.

---

## ADR Розподіл виконання вузла на дві стадії: Planning (Stage 1) і Execution (Stage 2)

## Context and Problem Statement
Виконання вузла поєднує в собі проектування (design, декомпозиція) і власне кодування/вирішення. Ці дві активності мають різний характер: перша — дослідницька з невизначеним виходом (атомарний або складений вузол), друга — детермінована (пишемо код, перевіряємо, виводимо результат). Змішання їх в одному кроці утруднює аудит і контроль людини.

## Considered Options
* Два окремих кроки: Stage 1 (`mt plan`) і Stage 2 (виконання)
* Один монолітний крок (агент сам вирішує коли планувати, а коли виконувати)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "два окремих кроки", because явна межа дозволяє людині або зовнішньому оркестратору зупинитись після planning і переглянути рішення (атомарний/складений) перед запуском execution; також спрощує retry — можна повторити лише Stage 2 без повторного планування.

### Consequences
* Good, because transcript фіксує очікувану користь: Stage 1 повертає або `plan_001.md` (атомарний шлях) або дочірні `task.md` + `mt spawn` (складений шлях) — два чіткі виходи без двозначності.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Stage 1 entry point: `mt plan` (всередині worktree після `mt run`). Stage 2: агент виконує роботу → `mt verify` (перевіряє критерії з `## Done when` у `task.md`) → пише `outputs_NNN.md` → сигналізує `mt done|audit|failed`.

---

## ADR Stage 1 `mt plan`: об'єднання design і decompose, режим через атрибут `mode:`

## Context and Problem Statement
Попередня система мала два окремі кроки: `mt init` (brainstorm, панель персон, `docs/specs/*.md`) і `mt plan` (декомпозиція, MT file-presence state). Вони дублювали налаштування та вимагали двох команд для однієї логічної активності — «зрозуміти задачу і вирішити як її виконати». Також потрібно підтримувати як інтерактивний режим (людина бере участь), так і повністю автономний (агент сам).

## Considered Options
* Об'єднати `mt init` і `mt plan` в один крок `mt plan` з атрибутом `mode:` в `task.md`
* Залишити два кроки: `mt init` → design, `mt plan` → decompose, обидва пишуть у `plan_001.md`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "один крок `mt plan` з атрибутом `mode:`", because transcript: "спільний крок, поєднуємо їх" — окремий `mt init` більше не існує; `plan_001.md` містить і обґрунтування, і декомпозицію/план в одному файлі.

### Consequences
* Good, because transcript фіксує очікувану користь: менше команд, менше перемикань, `plan_001.md` — єдиний артефакт Stage 1.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Атрибут `mode:` у frontmatter `task.md`: `human` (default) — агент веде інтерактивний діалог в терміналі; `agent` — автономно без участі людини. Preflight (перевірка що виконується в `.worktrees/`) переноситься з `mt init` в `mt plan`. Вихід `mt plan`: складений вузол → дочірні `task.md` + виклик `mt spawn`; атомарний вузол → `plan_001.md` у кореневій теці вузла.
