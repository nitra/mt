---
session: 299215fa-4d9f-4dab-8c36-cbc5cea3b0d6
captured: 2026-06-07T06:21:08+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/299215fa-4d9f-4dab-8c36-cbc5cea3b0d6.jsonl
---

Let me first save all decisions before implementing.

---
[assistant]
[tool: Edit] {"replace_all":false,"file_path":"/Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md","old_string":"## Інтеграція з `mt`\n\n`flow` — протокол всередині вузла. `graph` — оркестратор ззовні.\n\n### Два етапи виконання вузла\n\n**Етап 1 — Planning (`mt plan`)**","new_string":"## Інтеграція з `mt`\n\n> **Статус:** `mt` — **ліквідовано** за рішенням ітеративного дизайну 2026-06-07.\n> Весь функціонал поглинуто в `mt`.\n\n`flow` — протокол всередині вузла. `graph` — оркестратор ззовні.\n\n### Два етапи виконання вузла\n\n**Етап 1 — Planning (`mt plan`)**"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
[tool: Read] {"file_path":"/Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md","offset":288,"limit":80}
[user]
[tool_result] 288	### Stage 1 — `mt plan` (тепер `mt plan`)
[assistant]
[tool: Edit] {"replace_all":true,"file_path":"/Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md","old_string":"mt plan","new_string":"mt plan"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
[tool: Edit] {"replace_all":true,"file_path":"/Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md","old_string":"mt verify","new_string":"graph verify"}
[user]
[tool_result] The file /Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md has been updated successfully. (file state is current in your context — no need to Read it back)
[assistant]
[tool: Read] {"file_path":"/Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md","offset":285,"limit":70}
[user]
[tool_result] 285
286	### Stage 1 — `mt plan` (Planning)
287
288	| Атрибут task.md | Значення | Поведінка |
289
290	| `mode` | `human` (default) | Stage 1 = інтерактивний діалог |
291	| `mode` | `agent` | Stage 1 = автономно |
[assistant]
[tool: Read] {"file_path":"/Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md","offset":285,"limit":80}
[user]
[tool_result] 285
286	### Stage 1 — `mt plan` (Planning)
287
288	| Атрибут task.md | Значення | Поведінка |
289
290	| `mode` | `human` (default) | Stage 1 = інтерактивний діалог |
291	| `mode` | `agent` | Stage 1 = автономно |
292
293	**Composite шлях:**
[assistant]
[tool: Read] {"file_path":"/Users/vitaliytv/www/nitra/cursor/npm/docs/mt.md","offset":293,"limit":60}
[user]
[tool_result] 293	**Composite шлях:**
294	```
295	mt plan → (human/agent) → дочірні task.md → агент → mt spawn
296	```
297
298	**Atomic шлях:**
299	```
300	mt plan → (human/agent) → plan_001.md → Stage 2
301	```
302
303	### Stage 2 — Виконання (Execution)
304
303	### Stage 2 — Виконання (Execution)
304
305	```
306	агент читає plan_001.md → виконує роботу → writes outputs_NNN.md
307	→ mt done | mt audit <path> | mt failed
308	```
309
310	graph verify — **видалено**: перевірка замінена аудитом з черги.
311	MT file-presence state, `docs/specs/`, `docs/plans/` — **видалено**.
312
313	### Таблиця станів вузла
314
315	| Файли | Стан |
316	| `task.md` only | `waiting` |
317	| активний worktree | `running` |
318	| `pending-audit_NNN.md` є, без `run_NNN` від auditor | `pending-audit` |
319	| `outputs_NNN.md` є, без `invalidated` | `resolved` |
320	| `run_NNN.md` без `outputs_NNN.md` | `failed` |
321	| `invalidated` | `invalidated` |
322
323	### Нумерація файлів вузла
324
325	| Файл | Лічильник |
326	| `run_NNN.md` | незалежний (всі актори: agent, auditor) |
327	| `outputs_NNN.md` | незалежний (тільки успішні) |
328	| `plan_NNN.md` | незалежний (наразі max=1 на вузол) |
329	| `pending-audit_NNN.md` | = NNN з відповідного `outputs_NNN.md` |
330
330	### Нові команди `graph`
331
332	| Команда | Призначення |
333	| `mt plan [<path>]` | Stage 1: spec + decompose → `plan_001.md` або spawn |
334	| `mt audit <path>` | Signal: creates `pending-audit_NNN.md` |
335	| `mt watch` | Daemon: черга + аудит + моніторинг |
336	| `mt` | **ВИДАЛЕНО** |
337
338	### Видалені команди `flow`
339
340	| Команда | Причина видалення | Замінник |
341	| `mt init` | worktree створює `mt run` | `mt run` |
342	| `mt init` | поглинуто в `mt plan` | `mt plan` |
343	| `mt plan` | перейменовано | `mt plan` |
344	| `mt verify` | замінено аудитом | аудит-черга |
345	| `mt audit` | замінено аудитом | аудит-черга |
346	| `mt verify` | зайва обгортка | — |
347	| `mt run` | замінено `mt run` | `mt run` |
348	| `mt run` | стан у файлах | `mt run` (повторний) |
349	| `mt kill` | замінено `mt kill` | `mt kill` |
350	| `mt invalidate` | MT file-presence state зникло | — |
351
352	---
353
354	## Зведена таблиця рішень
[assistant]
Документ оновлено. Тепер оновлюю memory:
[assistant]
[tool: Write] {"file_path":"/Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/project_graph_flow_design.md","content":"---\nname: project-graph-flow-design\ndescription: Дизайн уніфікованої архітектури graph+flow (npm/docs/mt.md) — рішення прийняті в ітеративній дискусії 2026-06-07\nmetadata:\n  t
[user]
[tool_result] File created successfully at: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/memory/project_graph_flow_design.md (file state is current in your context — no need to Read it back)
[assistant]
Все зафіксовано. Дизайн завершено — `mt` ліквідовано, весь функціонал уніфіковано під `mt`. Рухаємось до реалізації B: прибираємо `flow` і переписуємо `mt plan` + сигнали?

---
[assistant]
<thinking>
The transcript ended. Now I need to produce ADR documentation based on the design decisions made in this session.

Let me identify the key design decisions:

1. **Ліквідація `mt`** — the entire `flow` namespace was eliminated and absorbed into `graph`
2. **Розділення на два етапи** — planning (Stage 1) and execution (Stage 2) within a node
3. **`mt plan` як Stage 1** — combining spec + decompose into one command, replacing `mt init` + `mt plan`
4. **`mode: human|agent` в task.md** — controlling whether Stage 1 is interactive or autonomous
5. **`plan_001.md` як артефакт Stage 1** — numbered, immutable plan file
6. **Variant B для composite path** — `mt plan` (now `mt plan`) creates child task.md files, agent calls `mt spawn` explicitly
7. **Аудит-черга замість `mt verify`** — `mt verify` eliminated, replaced entirely by async audit queue
8. **`pending-audit_NNN.md` з дзеркальною нумерацією** — the NNN in `pending-audit_NNN.md` mirrors the `outputs_NNN.md` number, creating an implicit reference
9. **Гібридний `mt verify`** — decided to use hybrid approach (script + LLM), but then eliminated entirely in favor of audit queue
10. **`run_NNN.md` як незалежний лічильник** — tracks all actors (agent, auditor) with independent numbering
11. **`mt watch` як демон+хук** — both a post-merge hook (one-shot) and daemon (persistent)

Let me group these into the most significant ADRs:

**ADR 1: Ліквідація `mt` та злиття з `mt`**
- Decision: eliminate the `flow` namespace entirely, merge all commands into `graph`
- Context: redundancy between flow (node-internal protocol) and graph (orchestrator)
- Rationale: single unified CLI, less cognitive overhead, natural evolution since graph already handles orchestration

**ADR 2: Розподіл виконання вузла на Stage 1 (plan) та Stage 2 (execute)**
- Decision: `mt plan` = spec + decompose; Stage 2 = write outputs + signal
- Context: need to formalize the distinction between planning and doing
- Key choices: plan_001.md as plan artifact, mode: human|agent in task.md

**ADR 3: Аудит-черга через `pending-audit_NNN.md` — дзеркальна нумерація**
- Decision: pending-audit_NNN.md file mirrors outputs_NNN.md NNN
- Context: identifying which output version needs auditing

**ADR 4: Ліквідація `mt verify`**
- Decision: eliminate self-check step, rely solely on async audit queue
- Context: discussion around whether self-check is needed

Let me write these out properly.
</thinking>

## ADR Ліквідація `mt` та злиття з `mt`

## Context and Problem Statement
Система `n-cursor` мала два паралельних namespace: `mt` (протокол всередині вузла: init/spec/plan/verify/release) і `mt` (оркестратор DAG). Обидва управляли worktree і описували «що треба зробити», що давало семантичне дублювання і дві точки входу для одного life-cycle задачі.

## Considered Options
* Залишити `flow` і `graph` як два окремих namespace, інтегрувавши їх через спільний worktree-контракт
* Зробити `flow` протоколом всередині вузла (попередній MT workflow), `graph` — оркестратором ззовні
* Ліквідувати `flow` повністю і поглинути весь функціонал у `graph`

## Decision Outcome
Chosen option: "Ліквідувати `flow` повністю і поглинути у `graph`", because дискусія показала, що `flow` як namespace є надлишковим: `mt run` вже замінює `mt run`, `mt kill` — `mt kill`, а `mt verify` та `mt audit` замінено аудит-чергою. Залишився б тільки `mt plan`, що не обґрунтовує окремий namespace.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина CLI-точка входу `mt` для всього life-cycle задачі, без перемикання між namespace.
* Bad, because `mt` закріплено у `.cursor/rules/n-flow.mdc` і в існуючій документації — потрібна міграція правил і посилань.

## More Information
Видалені команди та їх замінники: `mt init` → `mt run` (worktree), `mt init` → поглинуто у `mt plan`, `mt plan` → перейменовано на `mt plan`, `mt verify` → аудит-черга, `mt audit` → аудит-черга, `mt verify` → видалено (зайва обгортка), `mt run` → `mt run`, `mt run` → `mt run` (повторний, стан у файлах), `mt kill` → `mt kill`, `mt invalidate` → не потрібно (MT file-presence state зникло). Рішення зафіксовано у `npm/docs/mt.md` (розділ «Інтеграція з mt»).

---

## ADR Розподіл виконання вузла на Stage 1 (plan) і Stage 2 (execute)

## Context and Problem Statement
Після ліквідації `flow` потрібно визначити як агент всередині worktree виконує роботу: одним неперервним актом чи двома чіткими фазами — спочатку вирішення атомарний/складений і планування, потім виконання.

## Considered Options
* Один нерозділений крок: агент одразу виконує задачу без обов'язкового проміжного артефакту
* Два окремих кроки: `mt plan` (Stage 1) → виконання (Stage 2)

## Decision Outcome
Chosen option: "Два окремих кроки: `mt plan` → виконання", because Stage 1 вирішує фундаментальне питання — атомарний вузол чи складений — і це рішення має бути відокремлено від власне виконання. Крім того, `mode: human` (default) передбачає участь людини саме на етапі планування, не виконання.

### Consequences
* Good, because transcript фіксує очікувану користь: людина може зупинитись між Stage 1 і Stage 2 і переглянути `plan_001.md` перед виконанням.
* Good, because composite шлях (дочірні `task.md` + `mt spawn`) чітко відокремлений від atomic шляху (`plan_001.md` → виконання).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Атрибут `mode: human|agent` у front-matter `task.md` керує поведінкою Stage 1. Дефолт: `human` (інтерактивний діалог). Stage 1 виводить або `plan_001.md` (atomic), або дочірні `task.md` (composite), після чого агент явно викликає `mt spawn` (Variant B). Stage 2: агент читає `plan_001.md` → виконує → пише `outputs_NNN.md` → сигналізує `mt done|audit|failed`. Нумерація `plan_NNN.md` незалежна (наразі max=1 на вузол).

---

## ADR Аудит-черга через `pending-audit_NNN.md` із дзеркальною нумерацією

## Context and Problem Statement
Після ліквідації `mt verify` і `mt audit` потрібен зовнішній механізм якісного контролю: хтось незалежний від виконавця перевіряє чи `outputs_NNN.md` відповідає `## Done when` у `task.md`. При кількох циклах перегляду треба чітко розуміти яку саме версію виходу аудитор переглядає.

## Considered Options
* `.pending-audit` — порожній sentinel-файл (один, перезаписується при кожному новому запиті)
* `pending-audit_NNN.md` — numbered, immutable, NNN = власний незалежний лічильник
* `pending-audit_NNN.md` — numbered, NNN дзеркалює NNN відповідного `outputs_NNN.md`

## Decision Outcome
Chosen option: "`pending-audit_NNN.md` із NNN = NNN відповідного `outputs_NNN.md`", because ім'я файлу саме по собі є посиланням на версію виходу — `ref:` у front-matter зайвий. Це зберігає повну immutability і унеможливлює плутанину при кількох аудит-циклах.

### Consequences
* Good, because transcript фіксує очікувану користь: `pending-audit_003.md` однозначно означає «аудит `outputs_003.md`» без додаткових метаданих.
* Good, because лічильники `run_NNN.md` (всі актори: agent, auditor), `outputs_NNN.md` і `pending-audit_NNN.md` мають чітку семантику: `outputs` і `pending-audit` пов'язані, `run` — незалежний.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Повний аудит-цикл: `outputs_001.md` → `mt audit` → `pending-audit_001.md` → `mt watch` ставить у чергу → auditor-агент → `run_NNN.md (actor: auditor, result: failed)` → агент доробляє → `outputs_002.md` → `pending-audit_002.md` → `run_NNN.md (actor: auditor, result: success)` → merge. Стан вузла `pending-audit` = є `pending-audit_NNN.md` без відповідного `run_NNN.md` від auditor.

---

## ADR Ліквідація `mt verify` на користь аудит-черги

## Context and Problem Statement
`mt verify` виконував роль якісного гейту всередині вузла: спочатку структурна перевірка (outputs існує), потім семантична (LLM читає `## Done when`). Після введення аудит-черги виникло питання про дублювання.

## Considered Options
* Зберегти `mt verify` (гібрид: скрипт + LLM) як самоперевірку агента перед сигналом
* Видалити `mt verify`, залишити тільки аудит з черги

## Decision Outcome
Chosen option: "Видалити `mt verify`, залишити тільки аудит з черги", because самоперевірка агента і зовнішній аудит роблять одне й те саме — порівнюють `outputs_NNN.md` із `## Done when`. Підтримка двох механізмів дублює логіку без додаткової цінності.

### Consequences
* Good, because transcript фіксує очікувану користь: агент просто пише `outputs_NNN.md` і сигналізує — без проміжного gating-кроку.
* Bad, because агент-виконавець не має власного механізму самоперевірки перед `mt done` — якість залежить виключно від зовнішнього аудитора.

## More Information
Після рішення агент має два шляхи завершення: `mt done` (впевнений, merge без аудиту) або `mt audit <path>` (хоче зовнішню перевірку → `pending-audit_NNN.md` → черга). `mt verify` та пов'язані `verify_NNN.md` артефакти — не реалізуються. Рішення зафіксовано у `npm/docs/mt.md` рядком: «graph verify — видалено: перевірка замінена аудитом з черги».
