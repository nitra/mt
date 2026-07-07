# Архітектура: Динамічний Самомодифікований Граф Задач

> Версія документа: **0.2.0** — відповідає `@7n/mt@0.2.0`
>
> ⚠️ **Deprecated як цільова архітектура.** Цей документ лишається діючим контрактом реалізації `@7n/mt@0.2.x`, але цільова картина (граф задач + хости, пристрої, інтерактивні сесії, relay, membership) описана в [architecture.md](architecture.md) (0.3.0-draft); стек — у [stack.md](stack.md).

## Назва структури

**Рекурсивний складений ОАГ** (орієнтований ациклічний граф) — із динамічним розкладом вузлів та файловим сховищем стану.

---

## Концепція

### Вузол

Кожен вузол або є атомарним, або розкладається на підграф — рішення приймається **динамічно в Stage 1** на основі вхідних даних.

```
Вузол
  ├── реалізація:
  │     ├── Атомарний  — fn(вхідні) → вихідні
  │     └── Складений  — Граф{ вхід, вузли[], ребра[], виходи[] }
  ├── стан: unassigned | pending | waiting | blocked | plan-review | spawned | running | stalled | pending-audit | resolved | failed | unresolvable
  ├── вхідні:  Map<portId, Value>
  └── вихідні: Map<portId, Value>   ← заповнюється при resolved
```

Для батьківського вузла інтерфейс однаковий: він чекає `resolved` не знаючи що всередині (**інкапсуляція чорної скриньки**).

### Граф

- **ОАГ** — орієнтований, без циклів
- **Ребра** — потік даних: виходи одного вузла стають входами наступного
- **Топологія живе у `deps/` директорії кожного дочірнього вузла.** Жодного центрального файлу графу. Оркестратор відновлює повний граф скануванням усіх `task.md` і `deps/`.

---

## Naming convention вузлів

- Дозволені символи: `a-z`, `0-9`, `-`
- Роздільник: `-`
- Унікальність: в межах батька (серед сусідів в тій самій директорії)
- Приклади: `collect-data`, `analyze-results`, `synthesize`
- `id` вузла = назва директорії (не дублюється у фронтматері)
- Атрибути фронтматеру — англійські, snake_case
- **Всі імена файлів і директорій — англійська** (обробляються скриптами)
- Заголовки секцій що парсить скрипт — англійські; секції з довільними даними — будь-яка мова

---

## Файловий контракт вузла

### Структура

Дочірні вузли живуть **безпосередньо** в директорії батька. Якщо директорія містить `task.md` — це вузол.

```
mt/
  <node-id>/
    task.md                  ← місія (immutable після mt init)
    a.md                     ← прапор: виконує агент (model_tier, skills)
    h.md                     ← прапор: виконує людина (qualification)
    deps/                    ← залежності: кожен файл = одна залежність; ім'я = абсолютний dep-id від mt/
      quarterly-anomalies/
        collect-data.md      ← dep-id = quarterly-anomalies/collect-data
    plan_NNN.md              ← Stage 1 output (numbered, immutable; 001 при першому або після kill)
    plan-approved_NNN.md     ← plan-review: схвалено
    plan-rejected_NNN.md     ← plan-review: відхилено з причиною
    running_<pid>_until_<ts> ← git-ignored; локальна observability, НЕ lock
    run-draft.md             ← git-ignored; чернетка агента (Completed/Blockers/Next Attempt)
    run-summary.md           ← mutable; LLM-аналіз патернів невдач
    unresolvable.md          ← термінальний маркер: спроби вичерпано, чекає людину
    run_NNN.md               ← спроба виконавця
    fact_NNN.md              ← успішний результат; NNN = NNN відповідного run_NNN.md
    pending-audit_NNN.md     ← запит аудиту; NNN = NNN відповідного fact_NNN.md
    audit-result_NNN.md      ← фінальний вердикт аудитора; NNN = NNN pending-audit_NNN.md
    clarification_NNN.md     ← запит уточнення від аудитора; NNN = NNN pending-audit
    amended_NNN.md           ← виправлена відповідь агента
    history/                 ← аудит-trail: invalidate/kill архіви
      <ts>-invalidate/       ← архів fact_*.md + run_*.md при mt invalidate
    <child-node-id>/         ← дочірній вузол (composite spawn)
      task.md
      ...                    ← та сама структура рекурсивно
```

`a.md` і `h.md` — **мутабельні прапори**. Визначають **хто** виконує. Ніколи обидва одночасно.

### Інваріанти

**Immutable файли** (не змінюються після створення): `task.md`, `plan_NNN.md`, `plan-approved/rejected_NNN.md`, `run_NNN.md`, `fact_NNN.md`, `pending-audit_NNN.md`, `clarification_NNN.md`, `amended_NNN.md`, `unresolvable.md`.

**Мутабельні**: `a.md`, `h.md`, `running_<pid>_until_*`, `run-draft.md`, `run-summary.md`.

**`schema_version:`** — перше поле у всіх файлах з YAML-фронтматером. Поточна версія: `1`. Невідома версія → fail closed: `[mt] FATAL: schema_version=N > supported=M`.

**Authoritative execution claim** — GitHub custom ref:

```
refs/mt/claims/<node-hash>
```

`node-hash` = перші 20 hex символів SHA-256 від `<tasks-root>\0<node-path>`.

Claim commit з файлом `.mt-claim.yml`:

```yaml
schema_version: 1
node: research/analyze
node_hash: <sha256(node-path)>
actor: agent
runner_id: server-1/4821
claimed_at: 2026-06-09T10:00:00Z
lease_until: 2026-06-09T11:00:00Z
token: 1d9c87d2-4f41-4e74-91c2-2d873a62bf04
generation: 1
base_sha: a1b2c3
```

Claim операції — лише через exact-SHA CAS: **create-only** (відсутній → create), **renewal** (зберігає token/generation, оновлює lease_until), **takeover** (після expiry + grace, новий token, generation+1).

**Grace period:**

| Фаза    | Умова                                                 | Дозволено                    |
| ------- | ----------------------------------------------------- | ---------------------------- |
| Active  | `now() ≤ lease_until`                                 | renewal, publish             |
| Grace   | `lease_until < now() ≤ lease_until + claim_grace_sec` | renewal оригінального runner |
| Stalled | `now() > lease_until + claim_grace_sec`               | takeover (exact-SHA CAS)     |

**Межа immutability:** до worktree — вільно; після — тільки нові файли. `mt done`/`mt audit` перевіряють `task.md`/`a.md`/`h.md` проти `origin/main` і відхиляють при будь-якому diff.

**`deps/`** — дзеркалює структуру `mt/`; ім'я файлу = абсолютний dep-id від `mt/`; вміст — опційні ref-нотатки. `ls -R deps/` + strip `.md` → dep-ids без читання вмісту.

**Авторинг у `## Children`:** відносні dep-посилання → `mt spawn` резолвить до абсолютних у `deps/`.

**Синтаксис посилань:**

```
ref: ../collect-data/fact_001.md              # весь файл
ref: ../collect-data/fact_001.md#results      # секція
ref: ../collect-data/fact_001.md lines 5-20  # діапазон рядків
```

**NNN-шкала — version chain:**

| Файл                   | NNN                              |
| ---------------------- | -------------------------------- |
| `run_NNN.md`           | sequential counter (N-та спроба) |
| `fact_NNN.md`          | NNN run що її створив            |
| `pending-audit_NNN.md` | NNN відповідного fact            |
| `audit-result_NNN.md`  | NNN відповідного pending-audit   |
| `clarification_NNN.md` | NNN відповідного pending-audit   |
| `amended_NNN.md`       | NNN відповідного clarification   |

Zero-padded до 3 цифр: `001`, `002`, …

`plan_NNN.md` — окрема логіка: worktree merged або робота продовжується → нумерація продовжується; після `mt kill` + re-init → починає з `001`.

---

### Схеми файлів

#### `task.md`

Immutable після `mt init`. Не містить виконавця — він у `a.md`/`h.md`.

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:00:00Z
budget_sec: 600
budget_hard_sec: 10800
budget_total_sec: 14400 # опціонально: сумарний chain-ліміт
progress_timeout_sec: 300 # kill якщо немає mtime-змін у worktree N сек
deadline: 2026-06-12T18:00:00Z # опціонально; сортування черги
audit: optional # required | optional | off
hint: atomic # опціонально: atomic | composite
parent: research/collect-data # відносно mt/; відсутній у кореневого
---

## Task

## Done when

## Check

<!-- кожен непорожній рядок — shell-команда (exit 0); # — коментар -->

bun test payments/

## Inputs
```

| Поле               | Обов'язкове | Примітка                                                                     |
| ------------------ | ----------- | ---------------------------------------------------------------------------- |
| `created_at`       | так         | ISO 8601                                                                     |
| `budget_sec`       | так         | м'який ліміт (агент перевіряє через ENV)                                     |
| `budget_hard_sec`  | ні          | hard kill; відсутнє → `budget_sec × budget_hard_sec_multiplier`; `0` → error |
| `budget_total_sec` | ні          | сумарний wall-clock chain; перевищення → unresolvable                        |
| `audit`            | ні          | default з `audit_policy` конфігу                                             |
| `## Task`          | так         |                                                                              |
| `## Done when`     | так         |                                                                              |
| `## Check`         | ні          | shell-команди; wrapper ганяє перед done/audit; fail → відмова сигналу        |

Пріоритет budget: CLI > `plan_NNN.md` > `.mt-override.json` > `task.md` > `.mt.json`.

**`audit`-політика:** `required` — лише `mt audit`; `optional` (дефолт) — агент обирає; `off` — `mt audit` ігнорується.

---

#### `a.md`

```yaml
schema_version: 1
created_at: ISO8601
model_tier: AVG # MIM | AVG | MAX; default AVG
skills:
  - bash
  - write-files
secrets:
  - STRIPE_KEY # опціонально; wrapper інжектить через ENV
retry_ladder: # опціонально; per-node override
  - {}
  - strategy: diagnose-first
```

---

#### `h.md`

```yaml
schema_version: 1
created_at: ISO8601
assignee: vkozlov
notify: true
qualification: 'senior backend engineer'
```

---

#### `plan_NNN.md`

Stage 1 output. Immutable.

````markdown
---
schema_version: 1
created_at: ISO8601
decision: atomic | composite
budget_sec: 3600 # уточнений (опціонально; перекриває task.md)
budget_hard_sec: 10800 # опціонально
progress_timeout_sec: 600 # опціонально
---

## Context

## Approach

## Children

```yaml
children:
  - id: collect-data
    mode: agent # обов'язково per-child
    model_tier: AVG
    skills: [bash, web-search]
    budget_sec: 1800
    export: true # default; false → не у ## children батьківського fact
    deps: []
    task: |
      Зібрати дані з API
  - id: analyze
    mode: human
    qualification: senior analyst
    deps: [collect-data]
    task: |
      Перевірити аномалії
```

## Risks
````

`## Children` — обов'язкова для `decision: composite`, заборонена для `decision: atomic`. `mode` per-child обов'язковий; дитина без `mode` → validation error на `mt spawn --approve`.

Після composite-плану вузол у `plan-review`. `mt spawn --approve` валідує і матеріалізує дітей; `mt spawn --reject --reason` → `plan-rejected_NNN.md`.

---

#### `fact_NNN.md`

Immutable. NNN = NNN відповідного `run_NNN.md`. Актуальний — з найбільшим NNN.

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

---

#### `run_NNN.md`

Immutable. Записується wrapper після завершення.

`result` enum: `success | failed | progress-timeout | budget-exceeded | claim-lost | merge-conflict | decomposed`

| Категорія         | Values                                                            | `fact_NNN.md` | `failed_streak` |
| ----------------- | ----------------------------------------------------------------- | ------------- | --------------- |
| Terminal success  | `success`                                                         | створюється   | скидається      |
| Execution failure | `failed`, `progress-timeout`, `budget-exceeded`, `merge-conflict` | ні            | +1              |
| Lifecycle         | `decomposed`, `claim-lost`                                        | ні            | не змінюється   |

```markdown
---
schema_version: 1
created_at: ISO8601
actor: agent | engineer | human | wrapper
result: budget-exceeded
wall_sec: 10800
tokens_in: 184200
tokens_out: 12400
cost_usd: 0.84
worktree: .worktrees/<node-hash>-<token> # failure — для debug
---

## Reasoning

## Completed ← обов'язково при failure

## Blockers ← обов'язково при failure

## Next Attempt ← обов'язково при failure

## Script

exit_code: 137
stderr: SIGKILL budget-exceeded

## Ref

ref: fact_001.md ← при success
```

Джерело секцій при failure — `run-draft.md` агента; fallback — телеметрія wrapper.

---

#### Решта файлів

**`pending-audit_NNN.md`** — Immutable. `{ schema_version, created_at, actor }`.

**`audit-result_NNN.md`** — Immutable. Пишеться виключно аудитором.

```markdown
---
schema_version: 1
created_at: ISO8601
actor: auditor
result: success | failed
---

## Reasoning
```

`failed` → fact відхилений, вузол повертається у `waiting` (rework), run N+1. Clarification — лише 1 раз; після `amended_NNN.md` → фінальний `audit-result_NNN.md`.

**`clarification_NNN.md`** — запит уточнення, **не вердикт**. `{ schema_version, created_at, actor, ## Questions }`.

**`amended_NNN.md`** — `{ schema_version, created_at, clarification_ref, ## Response }`. Timeout `clarification_timeout_sec` без amended → auto `audit-result: failed`.

**`run-summary.md`** — mutable; генерує wrapper (LLM, `audit_model` tier) після `run_summary_threshold` failure-ранів. Другий шар поверх Prior attempts резюме. Видаляється при `mt invalidate`/`mt kill`.

**`history/`** — не містить `task.md` → scan ігнорує. Глобальний архів kill: `<tasks-root>/.history/<ts>-kill-<path>/`.

---

## Стани вузла

Стан — **derived**: lifecycle з артефактів вузла, runtime ownership з remote claim refs.

| Умова                                                                                                 | Стан            |
| ----------------------------------------------------------------------------------------------------- | --------------- |
| `task.md` є, немає `a.md`/`h.md`                                                                      | `unassigned`    |
| `h.md` є, немає прийнятого fact, немає active claim                                                   | `pending`       |
| `a.md` є, deps resolved, немає active claim, немає прийнятого fact, `failed_streak < agent_retry_max` | `waiting`       |
| `a.md` є, deps НЕ resolved                                                                            | `blocked`       |
| active claim, `lease_until > now()`                                                                   | `running`       |
| claim існує, `lease_until + claim_grace_sec ≤ now()`                                                  | `stalled`       |
| composite plan без approve/reject                                                                     | `plan-review`   |
| composite approved, діти не всі resolved                                                              | `spawned`       |
| `pending-audit_N` є, `audit-result_N` немає                                                           | `pending-audit` |
| є прийнятий fact                                                                                      | `resolved`      |
| `unresolvable.md` існує                                                                               | `unresolvable`  |
| `failed_streak ≥ agent_retry_max`, немає active claim                                                 | `failed`        |

Пріоритет: `pending-audit` > `resolved` > `unresolvable` > `stalled` > `running` > `plan-review` > `spawned` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`

**Прийнятий fact** — актуальний `fact_N` (max NNN) без `pending-audit_N` або з `audit-result_N: success`.

**`failed_streak`:**

```
last_accepted_NNN = max(NNN серед прийнятих fact_*.md; 0)
failed_streak = count(run_*.md де result ∈ {failed, progress-timeout, budget-exceeded, merge-conflict}
                і NNN > last_accepted_NNN)
```

`decomposed` і `claim-lost` у streak не входять. Anchor — **останній прийнятий** fact.

**`audit_failed_streak`** — окремий лічильник поспіль відхилених аудитів (від max NNN до першого success). `audit_failed_streak ≥ audit_retry_max` → ескалація людині.

**Deps satisfaction:** dep вузол має бути `resolved`. Dep з відкритим аудитом → `blocked`. Dep без `fact_*.md` → `blocked-invalid-dep` (warning у `mt status`).

**Composite вузол:** стан визначається так само як атомарного — прийнятий fact → `resolved`. O(1).

**Composite `fact_NNN.md`** пише wrapper коли всі діти resolved: синтетична пара `run_NNN.md` (actor: wrapper, result: success) + `fact_NNN.md` (Summary = агрегація + `## children` refs). Рекурсивно вгору.

---

## Ролі

**Orchestrator (`mt watch`)** — scheduling: сканує граф, визначає ready вузли, запускає runners, відстежує аудити.

**Runner (`mt run`)** — execution: claim → worktree → агент → publish → release.

---

## CLI контракт

Конфіг: `MT_DIR` env або `.mt.json` → `mt_dir`, дефолт `./mt/`. Всі команди підтримують `--json`.

```
mt setup                              ← .mt.json + .mt/system-prompt.md + mt/ + git hook
mt init <name> [--task "..."] [--mode agent|human] [--budget-sec N]
mt plan [<path>] [--mode agent|human] ← явне планування або форсоване перепланування
mt status [<path>] [--json]
mt scan [--json]                      ← exit 1 якщо є failed
mt run [<path>] [--actor a] [--auto]
mt kill <path> [--no-cascade]         ← archive + git rm; перевіряє active claims і reverse deps
mt invalidate <path>                  ← архів version chain → history/; cascade deferred (hash-diff)
mt done <path>                        ← fact + ## Check + fenced publish
mt audit <path>                       ← fact + ## Check + pending-audit_NNN.md + publish
mt failed <path>                      ← run_NNN.md (failed)
mt spawn <path> --approve | --reject --reason "..."
mt stop <path>                        ← SIGTERM + CAS-delete claim + rm worktree
mt cleanup [--older-than N]           ← orphan worktrees/run-refs без active claim
mt watch                              ← periodic rescan
```

**`mt kill`:** перевіряє active claims і reverse deps (live вузли що посилаються через `deps/`) → fail за замовчуванням; `--force` обходить. Послідовність: перевірка → архів в `.history/<ts>-kill-<path>/` → `git rm -r` → fenced publish.

**`mt invalidate`:** архівує version chain → `history/<ts>-invalidate/`; `task.md`/`a.md`/`h.md`/`deps/`/`plan_*` залишаються; нова chain з 001. Нащадки → `blocked` (deferred). Після re-run `mt done` порівнює hash нового fact з hash попередньої chain: однаковий → нащадки розблоковуються без архівації; різний → cascade `mt invalidate` вниз.

---

## Вузол як агент

Кожен вузол — запуск Claude. Протокол: `.mt/system-prompt.md`; файли вузла — місія та дані.

```
Claude(
  system_prompt = .mt/system-prompt.md,
  context       = [task.md] + [a.md|h.md] + [deps/] + [plan_*.md] +
                  [Prior attempts резюме] + [run-summary.md якщо є] + [audit-result_*.md]
)
```

**Prior attempts резюме:** wrapper стискає всі failure-рани у компактне резюме (Completed/Blockers/Next Attempt). Після `run_summary_threshold` failure-ранів — додатково `run-summary.md` (LLM, другий шар).

Агент веде `run-draft.md` протягом роботи. При завершенні wrapper переносить секції у `run_NNN.md`.

Для `actor: engineer` — окремий `.mt/engineer-prompt.md`; отримує повний `run_NNN.md` history.

---

## Два етапи виконання

**Етап 1 — Планування:**

- Агент (`a.md`): inline-фаза `mt run` — пише `plan_NNN.md` першою фазою без окремого процесу
- Людина (`h.md`) або форсоване перепланування: явний `mt plan`

Вихід:

- **Atomic** → `plan_NNN.md` → Етап 2 одразу (той самий run/claim/worktree)
- **Composite** → `plan_NNN.md` (+ `## Children`) → `plan-review` → `mt spawn --approve` → діти

**Етап 2 — Execution:**

```
агент виконує → пише fact_NNN.md →
  mt done   ← впевнений → ## Check → fenced publish
  mt audit  ← хоче перевірку → pending-audit_NNN.md → publish
  mt failed ← провал → run_NNN.md (failed)
```

---

## Оркестрація

`mt run --auto` (one-shot, post-merge hook) і `mt watch` (rescan кожні 5 хв або по `touch .mt/wake`).

Координація через `refs/mt/claims/<node-hash>` — перший CAS-push отримує ownership.

```
merge → post-merge hook → mt run --auto + touch .mt/wake

mt watch / mt run --auto:
  waiting + a.md  →  перевірка agent_concurrency + disk →
                     CAS claim → mt run (plan inline якщо відсутній)
  pending + h.md  →  skip + notify assignee
  pending-audit без audit-result →  mt run --actor auditor
    (є clarification без amended → mt run --actor agent --amend)
  failed (streak ≥ agent_retry_max) → mt run --actor engineer
  plan-review → skip (чекає approve)
  streak ≥ agent_retry_max + engineer_retry_max → unresolvable.md + алерт
  count(plan-rejected_*.md) ≥ plan_reject_max → unresolvable.md + алерт
```

Сортування черги `waiting`: leaf nodes першими, потім за `deadline`, потім за `created_at`.

---

## Аудит (async черга)

Блокуючий гейт: вузол з відкритим аудитом = `pending-audit`; залежні чекають фінального вердикту.

**Тригери:** `mt audit` (on-demand), `audit_schedule_days` (scheduled), `audit_on_patch: true` (після re-run).

**Потік:**

```
агент: fact_NNN.md → mt audit → pending-audit_NNN.md → fenced publish

watch → mt run --actor auditor:
  success → audit-result_NNN.md (success) → publish → resolved
  failed  → audit-result_NNN.md (failed)  → publish → waiting (rework, run N+1)
  clarification_NNN.md (не вердикт) → publish →
    mode agent: mt run --actor agent --amend → amended_NNN.md
    mode human: notify → людина пише amended вручну
    → повторний mt run --actor auditor → фінальний audit-result_NNN.md
```

Clarification — лише 1 раз. Timeout `clarification_timeout_sec` (дефолт: 86400) без amended → auto `audit-result: failed`.

`audit_failed_streak ≥ audit_retry_max` (дефолт: 3) → ескалація людині.

`audit_model: "auto"` — tier виконавця вузла; явний model id перекриває.

---

## Wrapper і fenced publish

**Wrapper** (`mt run`): перевіряє deps resolved + no pending-audit → CAS claim → detached worktree від `base_sha` → run ref `refs/mt/runs/<node-hash>/<token>` → запускає агента → polling → пише `run_NNN.md` → publish.

ENV для агента: `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, `MT_RUN_NNN`, `MT_ATTEMPT`, `MT_CLAIM_TOKEN`, `MT_CLAIM_GENERATION`.

**Fenced publish protocol** (агент, аудитор, lifecycle-операції):

```bash
git fetch origin main
git -C <worktree> rebase origin/main
# Перевірити exact claim SHA/token
git push --atomic \
  --force-with-lease=refs/heads/main:<expected-main-sha> \
  --force-with-lease=refs/mt/claims/<node-hash>:<claim-sha> \
  --force-with-lease=refs/mt/runs/<node-hash>/<token>:<run-sha> \
  origin \
  <result-sha>:refs/heads/main \
  :refs/mt/claims/<node-hash> \
  :refs/mt/runs/<node-hash>/<token>
```

Push відхилено → retry з exponential backoff (`publish_retry_base_ms` × 2, ліміт `publish_retry_max`). Вичерпано → `result: merge-conflict`.

Failure-сімейство: `run_NNN.md` публікується окремим fenced push; run ref/worktree лишається для debug; claim звільняється CAS-delete.

**Protected `main`:** runner не отримує bypass → integration branch + PR (approval-only) → integration bot виконує той самий fenced push. Другого шляху запису в `main` немає. `mt setup` перевіряє branch protection — fail closed без неї.

**Батчинг publish:** кілька готових результатів → один atomic push (один оновлення `main`).

**Single publish owner:** лише один runner може записати результат у `main`. Mutual exclusion виконання не гарантується — для non-idempotent side effects потрібен `generation` як fencing token.

---

## mt cleanup / mt watch

**`mt cleanup [--older-than N]`** (дефолт: 7 днів): видаляє orphan worktrees (без active claim), локальні running-маркери мертвих процесів, remote orphan run refs. `mt watch` викликає при кожному старті.

**`mt watch`** — periodic rescan (5 хв або по wake); не persistent daemon:

- Будує authoritative список claims: `git ls-remote origin 'refs/mt/claims/*'`
- Dispatch: аудит, amend, EngineerAgent, unresolvable, GC orphan run refs (старші `run_ref_ttl_days`)
- Composite агрегація: `mt done <child>` → wrapper перевіряє siblings → якщо всі resolved → пише батьківський run+fact → рекурсивно вгору

exit: `0` — проблем немає | `1` — є вузли що потребують уваги.

---

## Протокол spawn

```
mt plan → decision: composite (## Children) → plan-review:
  mt spawn --approve:
    1. Валідує ## Children: naming, mode per-child, deps існують, циклів немає
    2. Матеріалізує дітей: task.md + a.md/h.md + deps/<absolute-path>.md
    3. plan-approved_NNN.md + всі файли дітей — ОДИН fenced atomic commit
  mt spawn --reject --reason "..." → plan-rejected_NNN.md → waiting → наступний plan бачить причину
```

**Правило легітимності:** вузол легітимний ↔ його id у `## Children` approved-плану батька або кореневий (`mt init`). Інші директорії з `task.md` → `orphan-node` warning, runner пропускає.

**Динамічна декомпозиція** (виявлена під час Stage 2): агент пише `plan_NNN+1.md` (composite) → `result: decomposed` → `plan-review` → той самий шлях.

---

## Протокол патчу вузла

```
1. mt stop <наступники> у топологічному порядку (від листів до цілі)
2. mt invalidate <ціль>
3. патч → fenced publish
4. runner підхоплює нащадків автоматично після resolved
```

`mt kill` — тільки для остаточного видалення вузла і піддерева з topology.

---

## Паралельне виконання

Незалежні вузли ОАГ — паралельно, кожен у своєму git worktree. **Remote publish = межа атомарності:** наступник стартує лише після resolved попередника.

Worktree path унікальний через UUID token claim-а. Конфлікт злиття = звичайний `failed` → EngineerAgent.

`agent_concurrency` — ліміт active agent claims (людські h.md не рахуються).

---

## Політика ретраїв (retry ladder)

До `agent_retry_max` (дефолт: 3) невдалий вузол лишається `waiting` — агент ретраїть за драбиною:

| `MT_ATTEMPT` (= failed_streak + 1) | Поза спроби                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| 1                                  | базова                                                                               |
| 2                                  | diagnose-first — відтворити та діагностувати Blockers                                |
| 3                                  | alternative-approach — попередні підходи заборонені; `model_tier: +1` + `skills_add` |

```yaml
retry_ladder:
  - {}
  - strategy: diagnose-first
  - strategy: alternative-approach
    model_tier: +1
    skills_add: [debug]
```

Коротша за `agent_retry_max` → останній щабель повторюється. Тільки для `actor: agent`; інженер — за `.mt/engineer-prompt.md`.

---

## Самовідновлення: агент-інженер

**Тригер:** `failed_streak ≥ agent_retry_max` → watch запускає `mt run <path> --actor engineer`.

Інженер отримує: task + deps + повний `run_NNN.md` history, system prompt `.mt/engineer-prompt.md`.

Може: `mt stop`, `mt invalidate`, `mt kill`, GraphPatch (замінити вузол, вставити проміжні, перепідключити ребра). Адаптує стратегію до залишку `budget_total_sec`.

Streak ≥ `agent_retry_max + engineer_retry_max` → watch пише `unresolvable.md` + алерт.

---

## Ескалація: unresolvable

```
Тригер 1: failed_streak ≥ agent_retry_max + engineer_retry_max
          → unresolvable.md ("execution failures exhausted") + алерт
Тригер 2: count(plan-rejected_*.md) ≥ plan_reject_max
          → unresolvable.md ("plan disagreement") + алерт
Тригер 3: sum(wall_sec) > budget_total_sec → unresolvable (негайно)

Вихід (людина вирішує):
  mt invalidate <X> [+ правка task.md] → нова chain, лічильники скинуто
  mt kill <X>
  mt run <предок> --actor engineer     ← ширший GraphPatch
```

Runner і watch пропускають `unresolvable` вузли; залежні лишаються `blocked`.

---

## Конфігурація (`.mt.json`)

```json
{
  "schema_version": 1,
  "mt_dir": "./tasks",
  "worktrees_dir": "./.worktrees",
  "git_remote": "origin",
  "claim_ref_prefix": "refs/mt/claims",
  "run_ref_prefix": "refs/mt/runs",
  "claim_lease_sec": 3600,
  "claim_renew_sec": 300,
  "human_claim_lease_sec": 86400,
  "human_claim_renew_sec": 1800,
  "claim_grace_sec": 60,
  "publish_retry_max": 8,
  "publish_retry_base_ms": 250,
  "warn_worktrees_above": 4,
  "agent_concurrency": 5,
  "max_worktree_age": 14400,
  "run_ref_ttl_days": 14,
  "min_free_disk_gb": 10,
  "default_budget_sec": 1800,
  "default_budget_hard_sec": 3600,
  "budget_hard_sec_multiplier": 3,
  "progress_timeout_sec": 300,
  "stderr_lines": 50,
  "default_model_tier": "AVG",
  "plan_temperature": 0,
  "agent_retry_max": 3,
  "engineer_retry_max": 2,
  "plan_reject_max": 3,
  "audit_retry_max": 3,
  "retry_ladder": [
    {},
    { "strategy": "diagnose-first" },
    { "strategy": "alternative-approach", "model_tier": "+1", "skills_add": ["debug"] }
  ],
  "run_summary_threshold": 5,
  "claude_model": "claude-sonnet-4-6",
  "audit_policy": "optional",
  "audit_model": "auto",
  "model_map": {
    "MIM": "claude-haiku-4-5-20251001",
    "AVG": "claude-sonnet-4-6",
    "MAX": "claude-opus-4-8"
  },
  "skill_profiles": {
    "bash": { "allow": ["bun", "git"], "network": false, "fs_scope": "worktree" },
    "web-search": { "network": true }
  },
  "stale_worktree_min": 30,
  "system_prompt": ".mt/system-prompt.md",
  "audit_schedule_days": null,
  "audit_on_patch": false,
  "clarification_timeout_sec": 86400,
  "clarification_reminder_interval_sec": 21600
}
```

`schema_version` — перше поле; невідома або відсутня → fail closed. `budget_hard_sec: 0` → validation error. Per-node override: `mt/<node>/.mt-override.json`.

---

## Bootstrap

```bash
# Передумова: branch protection на main (bypass лише для MT runner/bot identities)
mt setup   # .mt.json + .mt/system-prompt.md + mt/ + git hook; fail closed без branch protection

# Periodic scan: */5 * * * * mt watch

mt init my-project --task "..." --mode agent --budget-sec 3600
# → mt/my-project/task.md + a.md; людина доповнює ## Done when + ## Check

mt run mt/my-project/   # або mt watch підхопить автоматично
```

---

## Наскрізний приклад

Задача: аномалії платежів Q4.

```bash
mt init quarterly-anomalies --mode agent --task "Дослідити аномалії платежів Q4"
```

1. **Watch** → `waiting` → claim → агент пише `plan_001.md` (composite: collect-data, analyze, review-findings) → `result: decomposed` → `plan-review`
2. **Approve** → `mt spawn --approve` → 3 дочірніх вузли + `plan-approved_001.md` → батько `spawned`
3. **collect-data** → claim → plan_001 (atomic) → агент → `fact_001.md` → `mt done` → `resolved`
4. **analyze** (audit: required) → спроба 1 → `run_001` (failed, streak=1) → MT_ATTEMPT=2 → `fact_002.md` → `mt audit` → `pending-audit_002` → аудит → `clarification_002` → `amended_002` → `audit-result_002: success` → `resolved`
5. **review-findings** (h.md) → `pending` → `mt run --actor human` → `fact_001.md` → `mt done` → `resolved`
6. **Wrapper** → всі діти resolved → синтетична пара `run_001`/`fact_001` у батьку (actor: wrapper) → `resolved`

---

## Монорепо: множинні `mt/` директорії

```
monorepo/
  mt/          ← глобальний mt/ (cross-workspace задачі)
  packages/
    api/
      mt/      ← api-specific задачі
    frontend/
      mt/
  .worktrees/  ← завжди в git root (спільні для всіх workspace)
```

- `MT_DIR` — вказує на конкретний `mt/`; один `mt watch` на один `mt/` root
- `mt setup` у workspace ініціалізує локальний `mt/` без зміни кореневого

**Обмеження:** `mt/` **не може** бути в `.gitignore`d-директорії. Scan пропускає `.gitignore`d, приховані (`.`), `node_modules`/`target`/`dist`/`build`.

---

## Security model

**Sandbox-профілі:** skill → профіль у `skill_profiles`: allowlist команд, network (off за замовчуванням), fs-scope (worktree). Команда поза allowlist → відмова.

**Secrets broker:** `a.md` → `secrets: [KEY]`; wrapper інжектить через ENV з OS keychain. У файлах вузлів секретів немає; wrapper маскує у виводах.

**PII:** `h.md` → `assignee: <handle>`; мапінг → `.mt/directory.json` (git-ignored). У git-history — лише handles.

**Read-scope:** агент читає файли будь-яких вузлів (trade-off); ізоляція — окремий `mt/` на команду/тенанта.

---

## Changelog

### 0.2.0 — 2026-06-11

Початкова версійована редакція. Охоплює повний контракт MT на момент релізу `@7n/mt@0.2.0`:

- Файловий контракт (task.md, a.md/h.md, deps/, plan/run/fact/audit)
- Стани вузла та derived-переходи
- CLI-контракт (`mt init / plan / run / done / audit / failed / spawn / kill / invalidate / scan`)
- Fenced publish + atomic CAS claim через GitHub custom refs
- Retry ladder, аудит-потік (clarification/amended), EngineerAgent, ескалація
- Security model, конфіг, bootstrap
