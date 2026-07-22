---
type: architecture
description: 'Вузли й ОАГ, файловий контракт, derived-стани, два етапи виконання, retry ladder і аудит'
tags: [graph, contract, states, audit]
timestamp: 2026-07-07
---

# Ядро: рекурсивний граф задач

> Частина цільової архітектури **0.3.0-draft** — [зміст](index.md) · [огляд](overview.md)

## Суть

Цей документ описує архітектурну модель, що реалізує рекурсивний граф задач з динамічним розкладом. Він визначає чіткий контракт для вузлів, які можуть бути атомарними або складеними, забезпечуючи інкапсуляцію та стійкість системи. Ключовим елементом є багаторівнева система станів, що керує життєвим циклом задач від ініціалізації до повного вирішення чи визнання нерозв'язною. Це гарантує прозорий та атомарний потік даних через весь процес виконання.

## Концепція

**Рекурсивний складений ОАГ** (орієнтований ациклічний граф) із динамічним розкладом вузлів та файловим сховищем стану.

### Вузол

Кожен вузол або атомарний, або розкладається на підграф — рішення приймається **динамічно в Stage 1** на основі вхідних даних.

```
Вузол
  ├── реалізація:
  │     ├── Атомарний  — fn(вхідні) → вихідні
  │     └── Складений  — Граф{ вхід, вузли[], ребра[], виходи[] }
  ├── стан: unassigned | pending | waiting | blocked | plan-review | spawned |
  │         running | stalled | pending-audit | resolved | failed | unresolvable
  ├── вхідні:  Map<portId, Value>
  └── вихідні: Map<portId, Value>   ← заповнюється при resolved
```

Для батьківського вузла інтерфейс однаковий: він чекає `resolved`, не знаючи, що всередині (**інкапсуляція чорної скриньки**).

### Граф

- **ОАГ** — орієнтований, без циклів.
- **Ребра** — потік даних: виходи одного вузла стають входами наступного.
- **Топологія живе у `deps/`** кожного дочірнього вузла. Жодного центрального файлу графу: оркестратор відновлює граф скануванням `task.md` і `deps/`.

### Naming convention

- Дозволені символи: `a-z`, `0-9`, `-`; роздільник `-`; унікальність — серед сусідів у директорії батька.
- `id` вузла = назва директорії (не дублюється у фронтматері).
- Усі імена файлів/директорій — англійська; атрибути фронтматеру — англійські, snake_case; секції, що парсить скрипт, — англійські.

## Файловий контракт вузла

Дочірні вузли живуть **безпосередньо** в директорії батька. Директорія містить `task.md` → це вузол.

```
mt/
  <node-id>/
    task.md                  ← місія (immutable після mt init)
    a.md                     ← прапор: виконує агент (model_tier, skills)
    h.md                     ← прапор: виконує людина (assignee, qualification)
    deps/                    ← кожен файл = одна залежність; ім'я = абсолютний dep-id від mt/
    plan_NNN.md              ← Stage 1 output (numbered, immutable)
    plan-approved_NNN.md     ← схвалено; МОЖЕ нести Ed25519-підпис (див. [access.md](access.md))
    plan-rejected_NNN.md     ← відхилено з причиною
    running_<pid>_until_<ts> ← git-ignored; локальна observability, НЕ lock
    run-draft.md             ← git-ignored; чернетка агента (Completed/Blockers/Next Attempt)
    run-summary.md           ← mutable; LLM-аналіз патернів невдач
    unresolvable.md          ← термінальний маркер: спроби вичерпано, чекає людину
    run_NNN.md               ← спроба виконавця (+ опційна секція ## Approvals)
    fact_NNN.md              ← успішний результат; NNN = NNN відповідного run
    pending-audit_NNN.md     ← запит аудиту
    audit-result_NNN.md      ← вердикт аудитора; МОЖЕ нести підпис
    clarification_NNN.md     ← запит уточнення від аудитора
    amended_NNN.md           ← виправлена відповідь агента
    history/                 ← аудит-trail: invalidate/kill архіви
    <child-node-id>/         ← дочірній вузол, та сама структура рекурсивно
```

`a.md`/`h.md` — **мутабельні прапори**; визначають, **хто** виконує; ніколи обидва одночасно.

### Інваріанти

- **Immutable** (після створення): `task.md`, `plan_NNN.md`, `plan-approved/rejected_NNN.md`, `run_NNN.md`, `fact_NNN.md`, `pending-audit_NNN.md`, `clarification_NNN.md`, `amended_NNN.md`, `unresolvable.md`. **Мутабельні**: `a.md`, `h.md`, `running_*`, `run-draft.md`, `run-summary.md`.
- **`schema_version:`** — перше поле всіх файлів із фронтматером. Невідома версія → fail closed.
- **Межа immutability:** до worktree — вільно; після — тільки нові файли. `mt done`/`mt audit` перевіряють `task.md`/`a.md`/`h.md` проти `origin/main` і відхиляють при diff.
- **`deps/`** дзеркалює структуру `mt/`; `ls -R deps/` + strip `.md` → dep-ids без читання вмісту. Відносні dep-посилання в `## Children` → `mt spawn` резолвить до абсолютних.
- **Синтаксис посилань:** `ref: ../collect-data/fact_001.md`, `…#section`, `… lines 5-20`.

**NNN-шкала — version chain** (zero-padded, `001`…):

| Файл | NNN |
| --- | --- |
| `run_NNN.md` | sequential counter (N-та спроба) |
| `fact_NNN.md` | NNN run, що її створив |
| `pending-audit_NNN.md` | NNN відповідного fact |
| `audit-result_NNN.md` / `clarification_NNN.md` | NNN відповідного pending-audit |
| `amended_NNN.md` | NNN відповідного clarification |

`plan_NNN.md` — окрема логіка: нумерація продовжується поки вузол живе; після `mt kill` + re-init → з `001`.

### Схеми файлів

#### `task.md`

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:00:00Z
budget_sec: 600
budget_hard_sec: 10800        # відсутнє → budget_sec × budget_hard_sec_multiplier; 0 → error
budget_total_sec: 14400       # опціонально: сумарний chain-ліміт
progress_timeout_sec: 300     # kill якщо немає mtime-змін у worktree N сек
deadline: 2026-06-12T18:00:00Z # опціонально; сортування черги
audit: optional               # required | optional | off
hint: atomic                  # опціонально: atomic | composite
parent: research/collect-data # відносно mt/; відсутній у кореневого
---

## Task
## Done when
## Check
<!-- кожен непорожній рядок — shell-команда (exit 0) -->
## Inputs
```

Обов'язкові: `created_at`, `budget_sec`, `## Task`, `## Done when`. `## Check` ганяється wrapper-ом перед done/audit; fail → відмова сигналу. Пріоритет budget: CLI > `plan_NNN.md` > `.mt-override.json` > `task.md` > `.mt.json`.

#### `a.md`

```yaml
schema_version: 1
created_at: ISO8601
model_tier: AVG        # MIN | AVG | MAX; default AVG
agent_cli: codex       # опціонально; claude | codex | cursor | pi — підписочний CLI (runtime.md)
skills: [bash, write-files]
secrets: [STRIPE_KEY]  # опціонально; wrapper інжектить через ENV
retry_ladder:          # опціонально; per-node override
  - {}
  - strategy: diagnose-first
interactive: false     # НОВЕ: true → вузол очікує інтерактивну сесію (див. runtime.md)
```

`model_tier` — джерело істини виконавця. Runner резолвить tier у **конкретну модель обраного CLI** через user-level env `MT_AGENT_CLI_MODEL_MAP[<cli>][tier]` (напр. codex: MIN→luna / AVG→terra / MAX→sola); CLI без мапінгу резолвить модель сам за підпискою користувача, tier завжди передається hint-ом env `MT_MODEL_TIER` ([runtime.md](runtime.md#підписочні-cli-виконавці-agent_cli)).

`agent_cli` (який підписочний CLI виконує вузол) — **per-node** прапор `a.md` з user-level дефолтом env `MT_AGENT_CLI`. Per-node вибір CLI — це крос-програмковий вимір [мети](../vision.md): спеціалізований тул на вузол.

#### `h.md`

```yaml
schema_version: 1
created_at: ISO8601
assignee: vkozlov          # handle; мапінг на account_id relay — .mt/directory.json (git-ignored)
notify: true               # relay шле push на пристрої assignee
qualification: 'senior backend engineer'
```

#### `plan_NNN.md`

````markdown
---
schema_version: 1
created_at: ISO8601
decision: atomic | composite
budget_sec: 3600            # уточнений (опціонально)
---

## Context
## Approach
## Children

```yaml
children:
  - id: collect-data
    mode: agent             # обов'язково per-child: agent | human
    model_tier: AVG
    skills: [bash, web-search]
    budget_sec: 1800
    export: true            # default; false → не у ## children батьківського fact
    deps: []
    task: |
      Зібрати дані з API
```

## Risks
````

`## Children` обов'язкова для `composite`, заборонена для `atomic`. Після composite-плану вузол у `plan-review`.

#### `plan-approved_NNN.md` (ЗМІНЕНО: опційний підпис)

```yaml
schema_version: 1
created_at: ISO8601
approved_by:               # опціонально; заповнюється при approve з пристрою
  account_id: <uuid>
  device_id: <uuid>
  signature: <base64 Ed25519 над (node_hash, plan NNN, "approved")>
```

Той самий блок — у `plan-rejected_NNN.md` (з `"rejected"` + `## Reason`) та `audit-result_NNN.md`. Approve з CLI на довіреній машині може не мати підпису (сумісність); політика `require_signed_approvals: true` робить підпис обов'язковим.

#### `fact_NNN.md`

```markdown
---
schema_version: 1
created_at: ISO8601
hash: sha256:<content-addressed: вміст fact + вміст усіх ref-цілей>
---

## Summary
Одне речення (обов'язково).

## <port-name>
ref: data/anomalies.json
```

**Composite-батько:** wrapper додає `## children` — `ref:` на актуальний fact кожної дитини (крім `export: false`).

#### `run_NNN.md` (ЗМІНЕНО: `handoff` у result, секція `## Approvals`, архів сесії)

`result` enum: `success | failed | progress-timeout | budget-exceeded | claim-lost | merge-conflict | decomposed | handoff`

| Категорія | Values | `fact_NNN.md` | `failed_streak` |
| --- | --- | --- | --- |
| Terminal success | `success` | створюється | скидається |
| Execution failure | `failed`, `progress-timeout`, `budget-exceeded`, `merge-conflict` | ні | +1 |
| Lifecycle | `decomposed`, `claim-lost`, `handoff` | ні | не змінюється |

```markdown
---
schema_version: 1
created_at: ISO8601
actor: agent | engineer | human | wrapper
result: success
wall_sec: 4200
tokens_in: 184200
tokens_out: 12400
cost_usd: 0.84
worktree: .worktrees/<node-hash>-<token>   # failure — для debug
session_archive: refs/mt/archive/<node-hash>/<NNN>  # НОВЕ, опціонально: повний session.jsonl
---

## Reasoning
## Completed   ← обов'язково при failure
## Blockers    ← обов'язково при failure
## Next Attempt ← обов'язково при failure

## Approvals   ← НОВЕ, опціонально: mid-run підписані approvals
<!-- один рядок YAML на approval -->
- { request_id: <uuid>, action: "edit_file config/prod.yml", approved: true,
    account_id: <uuid>, device_id: <uuid>, signature: <base64>, ts: ISO8601 }

## Script
exit_code: 0

## Ref
ref: fact_001.md   ← при success
```

Джерело секцій при failure — `run-draft.md` агента; fallback — телеметрія wrapper.

#### Аудит-файли

- **`pending-audit_NNN.md`** — `{ schema_version, created_at, actor }`.
- **`audit-result_NNN.md`** — пишеться виключно аудитором; `{ …, actor: auditor, result: success | failed }` + `## Reasoning` + опційний `approved_by`-підпис. `failed` → вузол у `waiting` (rework, run N+1).
- **`clarification_NNN.md`** — запит уточнення, не вердикт; лише 1 раз. Timeout `clarification_timeout_sec` без `amended_NNN.md` → auto `audit-result: failed`.
- **`run-summary.md`** — генерує wrapper (LLM) після `run_summary_threshold` failure-ранів; видаляється при `mt invalidate`/`mt kill`.
- **`history/`** — не містить `task.md` → scan ігнорує. Глобальний архів kill: `<tasks-root>/.history/<ts>-kill-<path>/`.

## Стани вузла

Стан — **derived**: lifecycle з артефактів вузла, runtime ownership з remote claim refs.

| Умова | Стан |
| --- | --- |
| `task.md` є, немає `a.md`/`h.md` | `unassigned` |
| `h.md` є, немає прийнятого fact, немає active claim | `pending` |
| `a.md` є, deps resolved, немає active claim/fact, `failed_streak < agent_retry_max` | `waiting` |
| `a.md` є, deps НЕ resolved | `blocked` |
| active claim, `lease_until > now()` | `running` |
| claim існує, `lease_until + claim_grace_sec ≤ now()` | `stalled` |
| composite plan без approve/reject | `plan-review` |
| composite approved, діти не всі resolved | `spawned` |
| `pending-audit_N` є, `audit-result_N` немає | `pending-audit` |
| є прийнятий fact | `resolved` |
| `unresolvable.md` існує | `unresolvable` |
| `failed_streak ≥ agent_retry_max`, немає active claim | `failed` |

Пріоритет: `pending-audit` > `resolved` > `unresolvable` > `stalled` > `running` > `plan-review` > `spawned` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`.

- **Прийнятий fact** — актуальний `fact_N` (max NNN) без `pending-audit_N` або з `audit-result_N: success`.
- **`failed_streak`** — count(run із result ∈ execution-failure і NNN > останнього прийнятого fact). `decomposed`/`claim-lost`/`handoff` не рахуються.
- **`audit_failed_streak`** — окремий лічильник поспіль відхилених аудитів; ≥ `audit_retry_max` → ескалація людині.
- **Deps satisfaction:** dep має бути `resolved`; dep з відкритим аудитом → `blocked`; dep без fact → `blocked-invalid-dep` (warning).
- **Composite:** стан визначається як в атомарного; коли всі діти resolved, wrapper пише синтетичну пару `run`/`fact` (actor: wrapper) — рекурсивно вгору.

## Контекст агента

Кожен run вузла — запуск агента: протокол поведінки — `.mt/system-prompt.md`, файли вузла — місія та дані:

```
context = [task.md] + [a.md|h.md] + [deps/] + [plan_*.md] +
          [Prior attempts резюме] + [run-summary.md якщо є] + [audit-result_*.md]
```

**Prior attempts резюме** — два шари стискання невдач: wrapper компактує всі failure-рани у резюме (Completed/Blockers/Next Attempt); після `run_summary_threshold` failure-ранів — додатково `run-summary.md` (LLM-резюме, другий шар). Протягом роботи агент веде `run-draft.md`; при завершенні wrapper переносить секції у `run_NNN.md`.

## Два етапи виконання

**Етап 1 — Планування.** Агент: inline-фаза `mt run` (пише `plan_NNN.md` першою фазою). Людина або форсоване перепланування: явний `mt plan`. Вихід: **atomic** → Етап 2 одразу (той самий run/claim/worktree); **composite** → `plan-review` → `mt spawn --approve` → діти.

**Етап 2 — Execution.**

```
агент виконує → пише fact_NNN.md →
  mt done   ← впевнений → ## Check → fenced publish
  mt audit  ← хоче перевірку → pending-audit_NNN.md → publish
  mt failed ← провал → run_NNN.md (failed)
```

**Протокол spawn:** `mt spawn --approve` валідує `## Children` (naming, mode per-child, deps існують, циклів немає), матеріалізує дітей, комітить `plan-approved_NNN.md` + файли дітей **одним fenced atomic commit**. Вузол легітимний ↔ його id у `## Children` approved-плану батька або кореневий; інші директорії з `task.md` → `orphan-node` warning. **Динамічна декомпозиція** під час Stage 2: агент пише `plan_NNN+1.md` (composite) → `result: decomposed` → `plan-review`.

**Протокол патчу вузла:** `mt stop` наступників (від листів) → `mt invalidate <ціль>` → патч → fenced publish → runner підхоплює нащадків. `mt invalidate` архівує version chain у `history/`; після re-run порівняння hash нового fact: однаковий → нащадки розблоковуються; різний → cascade invalidate вниз. `mt kill` — тільки остаточне видалення піддерева з topology.

## Retry ladder, engineer, unresolvable

До `agent_retry_max` (3) вузол лишається `waiting`; агент ретраїть за драбиною (`MT_ATTEMPT` = failed_streak + 1): 1 — базова; 2 — diagnose-first; 3 — alternative-approach (`model_tier: +1`, `skills_add`). Коротша драбина → останній щабель повторюється.

**EngineerAgent:** `failed_streak ≥ agent_retry_max` → `mt run --actor engineer`: отримує task + deps + повний run-history + `.mt/engineer-prompt.md`; може `mt stop`/`invalidate`/`kill`/GraphPatch.

**Unresolvable:** (1) streak ≥ `agent_retry_max + engineer_retry_max`; (2) `plan-rejected` ≥ `plan_reject_max`; (3) `sum(wall_sec) > budget_total_sec` → `unresolvable.md` + алерт (relay push власнику). Вихід — людина: `mt invalidate` (+ правка task.md), `mt kill`, або `mt run <предок> --actor engineer`.

## Аудит (async черга)

Блокуючий гейт: вузол з відкритим аудитом = `pending-audit`; залежні чекають. Тригери: `mt audit`, `audit_schedule_days`, `audit_on_patch`.

```
агент: fact_NNN.md → mt audit → pending-audit_NNN.md → fenced publish
watch → mt run --actor auditor:
  success → audit-result (success) → resolved
  failed  → audit-result (failed)  → waiting (rework, run N+1)
  clarification (не вердикт) → agent --amend → amended → повторний аудит → фінальний вердикт
```

Аудитором може бути агент (`audit_model`) **або людина з роллю `approver+`** — тоді вердикт їде підписаним через relay (див. [access.md](access.md)), а хост матеріалізує `audit-result_NNN.md` з блоком підпису.

## Наскрізний приклад

Соло-розробник + аналітик. Задача: дослідити аномалії платежів Q4.

### Частина 1 — автономний граф

1. **Ініціалізація.** `mt init quarterly-anomalies --task "Дослідити аномалії платежів Q4" --mode agent --budget-sec 3600` → `task.md` + `a.md`; людина доповнює `## Done when` і `## Check`.
2. **Inline-план → composite.** Orchestrator бачить `waiting` → runner: CAS claim → worktree → агент пише `plan_001.md` (decision: composite) з трьома дітьми: `collect-data` (agent), `analyze` (agent, `audit: required`, deps: collect-data), `review-findings` (human, deps: analyze). Run завершується `result: decomposed` → вузол у `plan-review`.
3. **Approve.** `mt spawn --approve` валідує `## Children` → матеріалізує дітей + `plan-approved_001.md` одним fenced commit. Батько → `spawned`.
4. **collect-data — щасливий шлях.** claim → inline `plan_001` (atomic) → `fact_001.md` → `mt done` → `## Check` pass → `run_001` (success) → fenced publish → `resolved`.
5. **analyze — retry ladder + аудит.** Спроба 1 падає (`run_001` failed, `failed_streak = 1`) → retry `MT_ATTEMPT=2` (diagnose-first) → успіх: `fact_002.md`; `audit: required` → `pending-audit_002.md`. Аудитор сумнівається → `clarification_002.md` → агент `--amend` → `amended_002.md` → повторний аудит → `audit-result_002.md` (success) → `resolved`. Весь цей час review-findings **заблокований** (dep не resolved — блокуючий гейт).
6. **Людський вузол.** review-findings → `pending` + push assignee → людина перевіряє → `fact_001.md` → `mt done` → `resolved`.
7. **Composite-агрегація.** Всі діти resolved → wrapper пише синтетичну пару `run_001`/`fact_001` (actor: wrapper) із `## children`-refs → батько `resolved`.

### Частина 2 — те саме у цільовій картині (сесії, пристрої, мови)

8. **Failed-вузол підхоплюється в чат.** Уявімо, що на кроці 5 обидві спроби analyze впали. Аналітик на ноутбуці робить `mt attach mt/quarterly-anomalies/analyze/` — це **новий run того самого вузла** ([runtime.md](runtime.md)): CAS claim (`interactive: true`), worktree, реплей. Контракт незмінний — граф бачить звичайний run.
9. **Матеріалізація мовою учасника.** У аналітика `lang: uk` — README і task-контент у його worktree матеріалізовані українською ([i18n.md](i18n.md)); його правка нотаток компілюється в base перед publish.
10. **Handoff.** Обробка даних заважка для ноутбука — «перенести сюди» на сервері: тримач завершує хід, пише `run_NNN (result: handoff)`, CAS-delete; сервер створює claim (generation+1), успадковує журнал ([git.md](git.md)). Клієнт-ноутбук лишається підключеним до тієї самої кімнати.
11. **Підписаний approve з телефона.** Агент хоче виконати деструктивний крок (запис у прод-БД) → `ApprovalRequest` → телефон другого учасника (роль `approver`, **без git-доступу**) показує диф → Ed25519-підпис → рядок у `## Approvals` run-файлу ([access.md](access.md)).
12. **Завершення.** `mt done` → `## Check` → fenced publish; далі — кроки 5–7 як у частині 1. Стан графа в `main` не відрізняється від автономного проходження — сесійність і мови не лишають слідів у канонічному стані.
