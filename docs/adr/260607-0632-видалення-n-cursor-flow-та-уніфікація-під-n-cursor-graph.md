---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:32:06+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Зафіксовано. npm/docs/mt.md і memory оновлені з усіма рішеннями.

**Підсумок 5 gap-ів:**

| Gap | Рішення |
|---|---|
| Composite resolved | Roll-up run батька (per `mode`); `children-resolved` = derived |
| pending-audit lifecycle | Derived: оброблено якщо є auditor run з `created_at >` pending-audit |
| mode: human headless | `mt watch` пропускає; людина запускає вручну з IDE |
| Merge після аудиту | `mt watch` є wrapper — читає `.ncursor-signal`, merge on success |
| Race condition | Єдиний оркестратор `mt watch`; `mt run --auto` видалено |

Архітектура логічно закрита. Рухаємось до реалізації?

---

*Transcript ends here.*

---

## ADR Видалення `mt` та уніфікація під `mt`

## Context and Problem Statement
В існуючій кодовій базі ранній `mt` workflow охоплював init/spec/plan/verify/release і runner-операції run/resume/cancel/repair навколо MT file-presence state. Паралельно розвивалась архітектура автономного DAG-оркестратора (`npm/docs/mt.md`), заснована на файловій системі (`tasks/<node>/task.md`). Два протоколи дублювали відповідальності і мали несумісні контракти стану.

## Considered Options
* Зберегти `flow` як протокол всередині вузла, `graph` — як зовнішній оркестратор (два шари)
* Видалити `flow` повністю, всі команди перевести під `graph` (уніфікація)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Видалити `flow` повністю, всі команди перевести під `graph`", because `flow` як namespace виявився надлишковим — `mt plan` стає `mt plan`, а всі інші `flow`-команди або видаляються, або поглинаються еквівалентами у `graph`.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина точка входу `mt`, відсутність дублювання стану між MT file-presence state і `task.md`-файлами, спрощений mental model для агентів і розробників.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Видалені команди: `mt init`, `mt init`, `mt plan`, `mt verify`, `mt verify`, `mt audit`, `mt run`, `mt run`, `mt kill`, `mt invalidate`, `mt done`. Файл-диспетчер: `npm/scripts/dispatcher/index.mjs`. Правило: `.cursor/rules/n-flow.mdc`. Нова точка входу: `npm/scripts/graph/index.mjs` (ще не реалізовано — сесія завершена до впровадження після gap-аналізу).

---

## ADR `mt plan` — Stage 1: об'єднання spec і decompose

## Context and Problem Statement
Старий `flow` мав окремі команди `mt init` (brainstorm, панель персон) і `mt plan` (декомпозиція на кроки). Це змушувало агента і людину виконувати два послідовних кроки з різними артефактами (`docs/specs/*.md` і MT file-presence state). У новій архітектурі ці артефакти зникають на користь `task.md` / `outputs_NNN.md`.

## Considered Options
* Два окремі кроки: `graph spec` → `mt plan` (зберегти розмежування дизайн/декомпозиція)
* Один крок: `mt plan` (поєднати spec і decompose)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Один крок: `mt plan`", because людина може зупинитись між spec і plan тільки якщо процес це допускає, але спільний крок простіший і достатній — різниця між дизайном і декомпозицією вирішується всередині одного виклику.

### Consequences
* Good, because transcript фіксує очікувану користь: менше команд, один артефакт `plan_001.md` замість двох файлів у різних директоріях.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Артефакт `plan_001.md` — front-matter: `type: atomic|composite`, `created_at`, `mode`. Секції: `## Context`, `## Approach`, `## Risks`. Composite path: агент після `mt plan` явно викликає `mt spawn` (не автоматично). Atomic path: агент переходить до Stage 2 — пише `outputs_NNN.md`, потім `mt done | mt audit | mt failed`.

---

## ADR `pending-audit_NNN.md` — нумерація і lifecycle

## Context and Problem Statement
Потрібен механізм асинхронного аудиту: агент сигналізує що хоче зовнішню перевірку, оркестратор пізніше dispatches аудитора. При повторних спробах (агент доробив і знову просить аудит) файли не повинні перезаписуватись, щоб зберегти immutability. Оркестратор повинен знати чи вже оброблено конкретний запит аудиту.

## Considered Options
* Один файл `.pending-audit` (перезаписується) — Варіант A
* Numbered `pending-audit_NNN.md` де NNN = NNN відповідного `outputs_NNN.md` — Варіант B
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Numbered `pending-audit_NNN.md`, NNN = NNN outputs", because ім'я файлу саме по собі є посиланням на конкретну версію outputs — окремий `ref:` не потрібен. Нумерація не губиться між спробами.

### Consequences
* Good, because transcript фіксує очікувану користь: immutability зберігається, ланцюжок `outputs_003.md → pending-audit_003.md → run_004.md (auditor)` читається з файлів без зовнішнього стану.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Lifecycle: `pending-audit_NNN.md` вважається обробленим (derived) якщо існує `run_M.md` де `actor: auditor` і `created_at > pending-audit_NNN.created_at` (Варіант C з gap-аналізу). Front-matter формат: `created_at: ISO8601`, `actor: agent | human`. Ліміт: до 3 failed-audit-циклів → ескалація.

---

## ADR `mt watch` — єдиний оркестратор

## Context and Problem Statement
В початковому дизайні npm/docs/mt.md існував `mt run --auto` (one-shot після merge) і `mt watch` (демон). Якщо обидва запускаються одночасно, виникає race condition: два процеси можуть запустити той самий вузол у два worktrees.

## Considered Options
* `mt run --auto` (post-merge) + `mt watch` (демон) паралельно — Варіант A
* Єдиний оркестратор `mt watch`; post-merge hook тільки будить watch — Варіант B
* Idempotent check через `git worktree add` атомарно — Варіант C
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`mt watch` як єдиний оркестратор (Варіант B)", because усуває race condition архітектурно — один процес управляє чергою, `mt run --auto` видалено.

### Consequences
* Good, because transcript фіксує очікувану користь: відсутність race condition, `mt watch` покриває і execution, і audit queue, і стале worktrees.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Post-merge hook: тільки `kill -USR1 <watch-pid>` або подібний сигнал (конкретна реалізація не зафіксована в transcript). `mt watch` dispatches аудиторів через `mt run --actor auditor <path>` — той самий wrapper-механізм що і для execution агентів. Файл конфігу: `.n-cursor.json` (поле `max_worktrees`).

---

## ADR Composite вузол: derived `children-resolved` і roll-up run

## Context and Problem Statement
Composite вузол (розкладений `mt plan` у дочірній граф) ніколи не пише власний `outputs_NNN.md`. Але стан `resolved` визначається наявністю `outputs_NNN.md`. Без додаткового механізму composite вузол залишився б у `waiting` назавжди після того як усі його діти стали `resolved`.

## Considered Options
* Implicit: composite автоматично `resolved` коли всі діти `resolved` (без `outputs_NNN.md`) — Варіант A
* Roll-up run: оркестратор запускає батьківський вузол знову (actor за `mode` батька), агент пише `outputs_NNN.md` — Варіант B
* Останній merge дитини автоматично пише `outputs_NNN.md` батька — Варіант C
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Roll-up run (Варіант B), actor за `mode` батька", because roll-up дає семантичний сенс агрегації — батько може мати власне meaning (не просто сума дітей), і людина (`mode: human`) або агент (`mode: agent`) контролює цей крок.

### Consequences
* Good, because transcript фіксує очікувану користь: батьківський вузол завжди має власний `outputs_NNN.md`, однорідний протокол resolved-стану для всіх типів вузлів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`children-resolved` — derived state (без sentinel-файлу). Composite визначається по `plan_001.md` front-matter `type: composite`. При `children-resolved` `mt watch` ставить батька у чергу як звичайний `waiting` вузол (з урахуванням `mode`). Реалізація в `npm/scripts/graph/scan.mjs` (планується).
