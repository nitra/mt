---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-15T20:23:40+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Готово. Три зміни реалізовано:

1. **Result classification** — `decomposed` і `claim-lost` більше не входять у failure-сімейство; тільки `failed | progress-timeout | budget-exceeded | merge-conflict` рахуються в `failed_streak`

2. **`failed_streak` формула** — змінилась з арифметики за іменами файлів на підрахунок run-файлів з execution failures після останнього fact. Оркестратор тепер читає frontmatter `run_*.md`

3. **`plan_reject_max`** — новий поріг (default 3) у конфізі. Коли два агенти не можуть домовитись по плану → `unresolvable.md` + алерт людині (не EngineerAgent). `mt scan` відслідковує `count(plan-rejected_*.md)`
---

Аналізую сесію для ADR-нотаток.

<context_window_compacted>
[Previous context was compressed at this point. Below is the compressed context.]

# Context Summary

## Session Overview
This is a Ukrainian-language document editing session for `/Users/vitaliytv/www/nitra/mt/npm/docs/mt.md` — a specification document for the MT (Multi-Task) orchestration protocol. The session involves addressing reviewer feedback on the specification, with each round of feedback being analyzed, discussed with the user, and then implemented.

## Current Working Directory
`/Users/vitaliytv/www/nitra/mt`

## Completed Work Items

### 1. GitHub Merge API removed (already done)
- PR is approval-only (review + CI interface)
- Bot performs `git push --atomic` with same three `--force-with-lease` as direct publisher
- TOCTOU race eliminated

### 2. Differential cascade fix (already done)
- `mt invalidate` no longer eagerly cascades to descendants
- Target node archives version chain → goes to `waiting`
- Descendants naturally become `blocked` (facts untouched)
- After re-run: same hash → descendants unblock normally; different hash → cascade runs
- `mt kill` still performs eager cascade (correct for permanent deletion)

### 3. Patch protocol fix (already done)
- `mt kill` replaced with `mt stop + mt invalidate` for successors
- `mt invalidate` internally handles SIGTERM + CAS-delete claim for running nodes
- `mt stop` kept as standalone command for explicit process management
- Engineer agent protocol fixed: `mt kill` → `mt stop + mt invalidate` for dep-node patches

### 4. Dependency addressing — Option 3 implemented (already done)
- **Authoring**: relative paths in `## Children` (sibling = `collect-data`, up+cross = `../research/analyze`)
- **Storage**: `mt spawn` resolves to absolute paths from `mt/`, writes `deps/quarterly-anomalies/collect-data.md`
- **Orchestrator**: `ls -R deps/` + strip `.md` → absolute dep-id (no content reading needed)
- File content is optional (ref notes for agent only)
- Updated: `deps/` structure description, spawn protocol, orchestrator scan pseudocode, summary table

### 5. Result classification and streak formula (already done)
- `decomposed` = lifecycle transition (doesn't count toward `failed_streak`)
- `claim-lost` = ownership event (doesn't count toward `failed_streak`)
- Only `failed | progress-timeout | budget-exceeded | merge-conflict` = execution failures → increment `failed_streak`
- `failed_streak` formula changed from arithmetic on filenames to counting run files with execution failures after last fact (requires reading frontmatter of `run_*.md`)
- New config: `plan_reject_max: 3` — when agents can't agree on plan after N rejections → `unresolvable.md` + human alert (not EngineerAgent)
- `mt scan` tracks `count(plan-rejected_*.md)` per node

## Current Status
The user has just said "наступне зауваження?" (what's next?) after completing item 5.

## Key Architectural Decisions Made This Session
1. Bot uses same atomic push protocol as direct publisher (no GitHub Merge API)
2. `mt invalidate` = deferred cascade (target only, descendants blocked but facts intact)
3. `mt kill` = permanent topology removal with eager cascade
4. `mt stop` = standalone command (SIGTERM + CAS-delete claim, topology preserved)
5. Dependency dep-id = filename (absolute from `mt/`), authoring uses relative paths, spawn resolves
6. `decomposed` and `claim-lost` don't count toward `failed_streak`
7. `plan_reject_max` triggers human escalation (not EngineerAgent) for repeated plan disagreements

## Document Details
- File: `/Users/vitaliytv/www/nitra/mt/npm/docs/mt.md`
- All changes have been applied to the file already
- All changes successfully made

## Session Instructions
This is a transcript analyzer session. The user is responding to a system prompt that says to analyze the session and produce ADR (Architecture Decision Records) in MADR format in Ukrainian. But actually this session has been an active editing session — the user has been reviewing reviewer feedback items and making changes to the document based on the discussion. The workflow involves:
1. User presents reviewer comment
2. Assistant analyzes it
3. Discussion about approach
4. User agrees/adjusts
5. Implementation in the document
6. User asks "наступне" (next)

The system prompt for this conversation instructs generating ADR documentation from a transcript, but the actual conversation has been an active working session with file edits.
</context_window_compacted>

Based on the transcript so far, I'll generate the ADR documentation now.

---

## ADR Бот-публікатор використовує atomic push, а не GitHub Merge API

## Context and Problem Statement
На protected `main` пряма публікація через `git push --atomic` недоступна агенту напряму. Потрібен механізм запису, який зберігає ту саму гарантію single-publish-owner без TOCTOU-ризику.

## Considered Options
* Integration bot через GitHub Merge API
* Integration bot через той самий `git push --atomic` з `--force-with-lease`

## Decision Outcome
Chosen option: "Integration bot через `git push --atomic` з `--force-with-lease`", because PR є approval-only interface (review + CI), а реальний запис у `main` виконується ботом через той самий fenced atomic push що й direct publisher — перевірка claim і запис відбуваються в одній атомарній операції.

### Consequences
* Good, because TOCTOU race усунено — GitHub Merge API розриває перевірку та merge у дві окремі операції.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`. Секції "Publish protocol" та "Protected main fallback". Команда: `git push --atomic --force-with-lease=refs/mt/claims/<hash>:...`.

---

## ADR `mt invalidate` використовує відкладений cascade замість eager

## Context and Problem Statement
Специфікація містила суперечність: `mt invalidate` рекурсивно архівував facts усіх descendants (eager cascade), але пізніше стверджував що після re-run з однаковим hash descendants можна залишити `resolved`. Це неможливо — їх facts вже в `history/`.

## Considered Options
* Eager cascade: `mt invalidate` рекурсивно архівує facts усіх нащадків одразу
* Deferred cascade: `mt invalidate` архівує лише target-вузол; нащадки стають `blocked` зі збереженими facts

## Decision Outcome
Chosen option: "Deferred cascade", because нащадки природно стають `blocked` (upstream не `resolved`), їх facts лежать нетронутими. Після re-run: однаковий hash → нащадки автоматично розблоковуються; різний hash → `mt invalidate` запускається по нащадках рекурсивно з тим самим deferred механізмом.

### Consequences
* Good, because уникається зайва робота коли upstream result не змінився — differential cascade стає реальним.
* Good, because transcript фіксує очікувану користь: eager cascade завжди ≥ deferred за обсягом роботи; deferred або рівна (hash змінився), або менша (hash не змінився).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`, секція `mt invalidate`, рядки ~883–926. `mt kill` залишений з eager cascade — він призначений для постійного видалення topology. Команди: `mt invalidate <path>`, `mt kill <path>`.

---

## ADR `mt invalidate` виконує SIGTERM + CAS-delete claim перед архівацією

## Context and Problem Statement
Patch protocol використовував `mt kill` для зупинки successor-вузлів перед патчем залежного вузла. `mt kill` виконує `git rm -r`, знищуючи topology — після цього "restart каскаду" неможливий без повторної матеріалізації вузлів через `mt spawn --approve`.

## Considered Options
* `mt kill` для successor-вузлів у patch protocol
* Окремі команди `mt stop` + `mt invalidate`
* `mt invalidate` з вбудованим stop-кроком

## Decision Outcome
Chosen option: "`mt invalidate` з вбудованим stop-кроком", because `mt invalidate` на running-вузлі спочатку виконує SIGTERM + CAS-delete claim (або CAS-delete без SIGTERM для remote runner), а вже потім архівує version chain. `mt stop` залишений як standalone команда для explicit process management без скидання результатів.

### Consequences
* Good, because topology зберігається — вузли не треба відтворювати через `mt init` + `mt spawn --approve`.
* Good, because клас помилок між `stop` і `invalidate` де хтось встигає retake claim — усунений.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`, секція `mt invalidate` (~рядок 913), секція "Протокол патчу вузла що вже має залежних" (~рядок 1338). Engineer agent protocol: `mt stop + mt invalidate` замість `mt kill` для dep-node patches.

---

## ADR Dep-id — абсолютний шлях від `mt/`, авторинг відносний

## Context and Problem Statement
Dep-id для sibling-вузлів записувався як коротка назва (наприклад `collect-data.md`), що при вузлі `quarterly-anomalies/analyze` резолвилось у кореневий `mt/collect-data/` замість сусіда `mt/quarterly-anomalies/collect-data/`. Оркестратор не міг однозначно резолвити dep без контексту поточного вузла.

## Considered Options
* Завжди абсолютні dep-id від `mt/` (рекомендація reviewer)
* Відносні шляхи від поточного вузла з `../` кодуванням (варіант 2)
* Авторинг відносний, зберігання абсолютне (варіант 3)
* YAML dep-descriptor із полем `node:` у вмісті файлу

## Decision Outcome
Chosen option: "Авторинг відносний, зберігання абсолютне (варіант 3)", because оркестратор може `ls -R deps/` + strip `.md` без читання вмісту файлів; агент при написанні `## Children` використовує відносні шляхи (`collect-data` = сусід, `../research/analyze` = крос-рівень); `mt spawn` резолвить до абсолютних шляхів і записує `deps/quarterly-anomalies/collect-data.md`.

### Consequences
* Good, because оркестратор отримує однозначний dep-id без читання вмісту файлів.
* Good, because авторинг залишається зручним — короткі відносні назви для сусідів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`, секція `deps/` (~рядок 385), spawn protocol (~рядок 1355), scan pseudocode (~рядок 1837). Формула резолюції: `normalize(parent_path + "/" + dep_ref)`.

---

## ADR `decomposed` і `claim-lost` не входять у `failed_streak`; `plan_reject_max` ескалює на людину

## Context and Problem Statement
Специфікація зараховувала всі результати крім `success` у failure-сімейство та `failed_streak`. Але `decomposed` — штатний результат планування, а `claim-lost` — ownership event. Кілька відхилених composite plans могли вичерпати `agent_retry_max` без жодної execution failure, ескалюючи до EngineerAgent некоректно. Також виникав ризик нескінченного циклу між двома агентами (плануючий і review-агент), якщо вони не домовляються по плану.

## Considered Options
* Усі результати ≠ `success` — failure-сімейство (поточна поведінка)
* Розділити на категорії: execution failure / lifecycle transition / ownership event

## Decision Outcome
Chosen option: "Розділити на категорії", because `decomposed` і `claim-lost` не відображають помилку виконання задачі. Новий конфіг-параметр `plan_reject_max` (default 3) відслідковує `count(plan-rejected_*.md)` і при перевищенні → `unresolvable.md` + алерт людині (не EngineerAgent).

### Consequences
* Good, because execution failures (`failed | progress-timeout | budget-exceeded | merge-conflict`) ескалюють до EngineerAgent; plan disagreements — до людини. Два незалежних шляхи ескалації.
* Good, because вузол не потрапляє до EngineerAgent через repeated claim-lost (infrastructure issue, не execution failure).
* Bad, because `failed_streak` більше не обчислюється арифметично з імен файлів — оркестратор читає frontmatter `run_*.md` для фільтрації по `result:`. Більше I/O при скані.

## More Information
Файл `npm/docs/mt.md`, секція `run_NNN.md` result enum (~рядок 525), секція `failed_streak` (~рядок 749), секція "Ескалація: unresolvable" (~рядок 1574), `.mt.json` конфіг `plan_reject_max` (~рядок 1629). `mt scan` перевіряє обидва тригери: `failed_streak ≥ agent_retry_max + engineer_retry_max` та `count(plan-rejected_*.md) ≥ plan_reject_max`.
