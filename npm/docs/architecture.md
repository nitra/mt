# Nitra MT — цільна архітектура: граф задач, хости, пристрої та люди

> Версія документа: **0.3.0-draft**. Замінює `mt.md` (0.2.0, граф задач) та scaffold-spec v4 (nitra-agent, пристрої/сесії) як єдина цільова архітектура. Документ technology-agnostic; референсний стек — окремо в [stack.md](stack.md).

---

## Рішення злиття (нормативні)

Обидві попередні архітектури незалежно зійшлись на git-субстраті, «одному пері», worktree-ізоляції та ескалації до людини. Конфлікти вирішено так:

1. **Git CAS claim — єдине джерело істини «одного пера».** `refs/mt/claims/*` авторитетні для всіх режимів — автономних і інтерактивних. Relay lease **не видає**: він лише транслює `ClaimChanged` та прискорює handoff-нотифікації. Падіння relay → деградація до polling; нічого не ламається.
2. **Інтерактивна сесія = run вузла.** Чат-сесія — це не окрема сутність, а run MT-вузла з підключеними клієнтами. `session.jsonl` (журнал розмови) живе у run ref і пушиться **кожен хід** — це механізм міграції між пристроями та handover. У `main` потрапляє лише дистильований `fact_NNN.md`.
3. **Approvals — один криптографічний механізм на три гейти.** Ed25519-підписи пристроїв застосовуються до plan-review (`mt spawn --approve`), аудит-вердиктів і нових mid-run approvals деструктивних tool calls. Підписи матеріалізуються у файли вузла — git отримує криптографічний audit trail.
4. **Relay — ефемерний координатор, не сховище.** Presence, membership, пересилка подій, push, буфер live-хвоста. НЕ зберігає журнали, НЕ проксіює git, НЕ видає lease.
5. **Погляд на підграф як одну розмову — це `client_kind: "mt-dashboard"`**, спеціалізований клієнт, а не окремий тип сесії.
6. **Один код контракту.** Логіка claim/fenced publish/scan існує в одній реалізації; інші компоненти викликають її, а не дублюють (див. stack.md).

---

## Загальна картина

```
                          ┌──────────────────────────────┐
                          │   git remote (GitHub/Gitea)  │
                          │  main ── дистильований стан  │
   Шар 0: істина          │  refs/mt/claims/*  ── перо   │
                          │  refs/mt/runs/*    ── журнал │
                          │  refs/mt/archive/* ── архів  │
                          └──────┬───────────────┬───────┘
                    fetch/push   │               │   fetch/push
                          ┌──────┴──────┐  ┌─────┴───────┐
   Шар 1: хости           │ agent-server│  │ agent-server│   один процес
   (виконання)            │  (машина A) │  │ (сервер B)  │   на машину
                          └──┬───────┬──┘  └──────┬──────┘
              локальний WS / │       │ wss        │ wss
              in-process     │       └─────┬──────┘
                          ┌──┴──┐    ┌─────┴─────────────┐
   Шар 2: relay           │     │    │ relay: акаунти,   │  ефемерний:
   (координація live)     │     │    │ membership,       │  події, presence,
                          │     │    │ presence, push    │  push, буфер
                          │     │    └─────┬─────────────┘
                          │     │          │ wss
   Шар 3: поверхні     ┌──┴─────┴──────────┴────────────────┐
   (тонкі клієнти)     │ desktop-додатки · CLI/TUI · mobile │
                       │ mt-dashboard · viewer інших людей  │
                       └────────────────────────────────────┘
```

- **Шар 0 — git remote.** Повільний, надійний, повний стан: граф задач у `main`, claims, run-журнали, архіви. Працює без усіх інших шарів.
- **Шар 1 — хости.** На кожній машині (ноутбук, сервер, CI-runner) один процес `agent-server`: оркеструє (`watch`), виконує (`runner`), тримає інтерактивні сесії, роздає події клієнтам.
- **Шар 2 — relay.** Швидкий, ефемерний: хто онлайн, хто в задачі, live-дельти, підписані approvals, push «прокинься». Єдине персистентне — акаунти/membership/запрошення.
- **Шар 3 — поверхні.** Будь-який UI — рівноправний тонкий клієнт одного протоколу подій: десктоп-додатки різних спеціалізацій, CLI, телефон, dashboard. Жоден клієнт не виконує агента сам.

---

## Частина I — Ядро: рекурсивний граф задач

### Концепція

**Рекурсивний складений ОАГ** (орієнтований ациклічний граф) із динамічним розкладом вузлів та файловим сховищем стану.

#### Вузол

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

#### Граф

- **ОАГ** — орієнтований, без циклів.
- **Ребра** — потік даних: виходи одного вузла стають входами наступного.
- **Топологія живе у `deps/`** кожного дочірнього вузла. Жодного центрального файлу графу: оркестратор відновлює граф скануванням `task.md` і `deps/`.

#### Naming convention

- Дозволені символи: `a-z`, `0-9`, `-`; роздільник `-`; унікальність — серед сусідів у директорії батька.
- `id` вузла = назва директорії (не дублюється у фронтматері).
- Усі імена файлів/директорій — англійська; атрибути фронтматеру — англійські, snake_case; секції, що парсить скрипт, — англійські.

### Файловий контракт вузла

Дочірні вузли живуть **безпосередньо** в директорії батька. Директорія містить `task.md` → це вузол.

```
mt/
  <node-id>/
    task.md                  ← місія (immutable після mt init)
    a.md                     ← прапор: виконує агент (model_tier, skills)
    h.md                     ← прапор: виконує людина (assignee, qualification)
    deps/                    ← кожен файл = одна залежність; ім'я = абсолютний dep-id від mt/
    plan_NNN.md              ← Stage 1 output (numbered, immutable)
    plan-approved_NNN.md     ← схвалено; МОЖЕ нести Ed25519-підпис (див. Частину IV)
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

#### Інваріанти

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

#### Схеми файлів

##### `task.md`

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

##### `a.md`

```yaml
schema_version: 1
created_at: ISO8601
model_tier: AVG        # MIM | AVG | MAX; default AVG
skills: [bash, write-files]
secrets: [STRIPE_KEY]  # опціонально; wrapper інжектить через ENV
retry_ladder:          # опціонально; per-node override
  - {}
  - strategy: diagnose-first
interactive: false     # НОВЕ: true → вузол очікує інтерактивну сесію (Частина III)
```

##### `h.md`

```yaml
schema_version: 1
created_at: ISO8601
assignee: vkozlov          # handle; мапінг на account_id relay — .mt/directory.json (git-ignored)
notify: true               # relay шле push на пристрої assignee
qualification: 'senior backend engineer'
```

##### `plan_NNN.md`

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

##### `plan-approved_NNN.md` (ЗМІНЕНО: опційний підпис)

```yaml
schema_version: 1
created_at: ISO8601
approved_by:               # опціонально; заповнюється при approve з пристрою
  account_id: <uuid>
  device_id: <uuid>
  signature: <base64 Ed25519 над (node_hash, plan NNN, "approved")>
```

Той самий блок — у `plan-rejected_NNN.md` (з `"rejected"` + `## Reason`) та `audit-result_NNN.md`. Approve з CLI на довіреній машині може не мати підпису (сумісність); політика `require_signed_approvals: true` робить підпис обов'язковим.

##### `fact_NNN.md`

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

##### `run_NNN.md` (ЗМІНЕНО: `handoff` у result, секція `## Approvals`, архів сесії)

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

##### Аудит-файли

- **`pending-audit_NNN.md`** — `{ schema_version, created_at, actor }`.
- **`audit-result_NNN.md`** — пишеться виключно аудитором; `{ …, actor: auditor, result: success | failed }` + `## Reasoning` + опційний `approved_by`-підпис. `failed` → вузол у `waiting` (rework, run N+1).
- **`clarification_NNN.md`** — запит уточнення, не вердикт; лише 1 раз. Timeout `clarification_timeout_sec` без `amended_NNN.md` → auto `audit-result: failed`.
- **`run-summary.md`** — генерує wrapper (LLM) після `run_summary_threshold` failure-ранів; видаляється при `mt invalidate`/`mt kill`.
- **`history/`** — не містить `task.md` → scan ігнорує. Глобальний архів kill: `<tasks-root>/.history/<ts>-kill-<path>/`.

### Стани вузла

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

### Два етапи виконання

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

### Retry ladder, engineer, unresolvable

До `agent_retry_max` (3) вузол лишається `waiting`; агент ретраїть за драбиною (`MT_ATTEMPT` = failed_streak + 1): 1 — базова; 2 — diagnose-first; 3 — alternative-approach (`model_tier: +1`, `skills_add`). Коротша драбина → останній щабель повторюється.

**EngineerAgent:** `failed_streak ≥ agent_retry_max` → `mt run --actor engineer`: отримує task + deps + повний run-history + `.mt/engineer-prompt.md`; може `mt stop`/`invalidate`/`kill`/GraphPatch.

**Unresolvable:** (1) streak ≥ `agent_retry_max + engineer_retry_max`; (2) `plan-rejected` ≥ `plan_reject_max`; (3) `sum(wall_sec) > budget_total_sec` → `unresolvable.md` + алерт (relay push власнику). Вихід — людина: `mt invalidate` (+ правка task.md), `mt kill`, або `mt run <предок> --actor engineer`.

### Аудит (async черга)

Блокуючий гейт: вузол з відкритим аудитом = `pending-audit`; залежні чекають. Тригери: `mt audit`, `audit_schedule_days`, `audit_on_patch`.

```
агент: fact_NNN.md → mt audit → pending-audit_NNN.md → fenced publish
watch → mt run --actor auditor:
  success → audit-result (success) → resolved
  failed  → audit-result (failed)  → waiting (rework, run N+1)
  clarification (не вердикт) → agent --amend → amended → повторний аудит → фінальний вердикт
```

Аудитором може бути агент (`audit_model`) **або людина з роллю `approver+`** — тоді вердикт їде підписаним через relay (Частина IV), а хост матеріалізує `audit-result_NNN.md` з блоком підпису.

---

## Частина II — Координація через git

### Claim — авторитетне «одне перо»

**Authoritative execution claim** — git custom ref: `refs/mt/claims/<node-hash>`, де `node-hash` = перші 20 hex SHA-256 від `<tasks-root>\0<node-path>`. Claim commit містить `.mt-claim.yml`:

```yaml
schema_version: 1
node: research/analyze
node_hash: <sha>
actor: agent
runner_id: server-1/4821
claimed_at: 2026-06-09T10:00:00Z
lease_until: 2026-06-09T11:00:00Z
token: 1d9c87d2-4f41-4e74-91c2-2d873a62bf04   # = session_id інтерактивної сесії
generation: 1
base_sha: a1b2c3
interactive: false     # НОВЕ: true → інтерактивна сесія; впливає на lease-параметри
```

Операції — лише exact-SHA CAS:

| Операція | Умова | Ефект |
| --- | --- | --- |
| **create** | ref відсутній | новий token, generation 1 |
| **renewal** | Active/Grace, той самий runner | зберігає token/generation, оновлює `lease_until` |
| **takeover** | Stalled | новий token, generation+1 |
| **handoff** (НОВЕ) | Active, кооперативно | тримач: push run ref + CAS-delete; новий хост: create (новий token, generation+1) |

**Grace period:**

| Фаза | Умова | Дозволено |
| --- | --- | --- |
| Active | `now() ≤ lease_until` | renewal, publish, handoff |
| Grace | `lease_until < now() ≤ lease_until + claim_grace_sec` | renewal оригінального runner |
| Stalled | `now() > lease_until + claim_grace_sec` | takeover |

Інтерактивні сесії використовують коротші `interactive_claim_lease_sec`/`interactive_claim_renew_sec` (людина за пристроєм — швидкий heartbeat, швидкий takeover при зникненні хоста).

**Claim обмежує хости, НЕ клієнтів:** до сесії одночасно підключено скільки завгодно клієнтів будь-яких пристроїв та акаунтів-учасників; писати у вузол може лише тримач claim.

**Single publish owner:** лише тримач claim публікує результат у `main`. Mutual exclusion виконання не гарантується — для non-idempotent side effects `generation` слугує fencing token.

### Run ref і журнал сесії

Run ref: `refs/mt/runs/<node-hash>/<token>` — гілка робочого стану поточної спроби.

- **Автономний run:** wrapper оновлює run ref на власний розсуд (мінімум — на завершення); run ref потрібен для debug і fenced publish.
- **Інтерактивний run (ЗМІНЕНО):** **кожен хід** (turn) = коміт у worktree (правки файлів + append у `.nitra/session.jsonl`) + **негайний push run ref**. Це і є механізм міграції між пристроями, відновлення після смерті хоста та handover іншому користувачу. `session.jsonl` — event log розмови (Envelope-и, Частина III); `.nitra/state.json` — метадані (курсор, профіль провайдера). Ані `.nitra/`, ані скріншоти **ніколи** не потрапляють у `main`.

**Архів сесії:** при publish run ref видаляється (як у базовому MT), але якщо `session_archive: true` — журнал зберігається у `refs/mt/archive/<node-hash>/<NNN>` (GC за `archive_ttl_days`), а `run_NNN.md` отримує поле `session_archive:`. Handover-приватність: передача архіву = передача всіх чорнових реплік; операція «передати з нового checkpoint» (squash стану + обрізаний журнал у свіжий run) — TODO, зафіксований як обмеження.

### Fenced publish

Публікація результату (агент, аудитор, lifecycle-операції) — один атомарний push:

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

Push відхилено → retry з exponential backoff (`publish_retry_base_ms` × 2, ліміт `publish_retry_max`); вичерпано → `result: merge-conflict`. Failure-сімейство: `run_NNN.md` публікується окремим fenced push; run ref/worktree лишаються для debug; claim звільняється CAS-delete.

**Protected `main`:** runner без bypass → integration branch + PR (approval-only) → integration bot виконує той самий fenced push. Другого шляху запису в `main` немає; `mt setup` перевіряє branch protection — fail closed. **Батчинг:** кілька готових результатів → один atomic push.

### Паралельне виконання

Незалежні вузли — паралельно, кожен у своєму git worktree (path унікальний через token). **Remote publish = межа атомарності:** наступник стартує лише після resolved попередника. Конфлікт злиття = звичайний `failed` → EngineerAgent. `agent_concurrency` лімітує active agent claims (людські не рахуються).

---

## Частина III — Runtime: хости, сесії, поверхні

### agent-server — один хост-процес на машину

Уся логіка виконання живе в довгоживучому процесі `agent-server`. ВСІ поверхні — тонкі клієнти одного протоколу подій; жоден клієнт не викликає ядро агента напряму.

**Discovery / single-instance:** при старті сервер пише port-file (`~/.nitra/server.port`: port + pid + токен-хеш) і тримає lock-файл. Додаток перед запуском власного сервера читає port-file і пробує `ClientHello`; живий → підключається клієнтом; stale lock → перезаписує і стартує свій. Скільки б додатків не було запущено — agent-server один.

agent-server поєднує три ролі (колишні окремі процеси MT):

| Роль | Обов'язки |
| --- | --- |
| **Orchestrator** (колишній `mt watch`) | скан графа, ready-вузли, dispatch runners/аудитів, composite-агрегація, cleanup |
| **Runner** (колишній `mt run` wrapper) | claim → worktree → агент → publish → release; бюджети, watchdog, телеметрія |
| **Session host** (НОВЕ) | інтерактивні сесії: broadcast Envelope клієнтам, реплей, approvals, preview |

**Транспорти клієнтів:** (а) локальний WS `ws://127.0.0.1:{port}` з одноразовим токеном; (б) in-process канал (вбудовування в десктоп-додаток); (в) relay-клієнт — вихідне wss:// до relay для віддалених клієнтів. Reconnect з backoff.

### Wake: push замість polling

Базовий MT прокидався cron-ом кожні 5 хв. У цільовій архітектурі:

1. **Relay push «є нові події у задачі X»** → agent-server негайно ресканить відповідний вузол;
2. `post-merge` git hook → `mt run --auto` + `touch .mt/wake` (локальні мерджі);
3. **Cron/periodic rescan — fallback** (relay недоступний → система працює як базовий MT).

`mt watch`-логіка (dispatch, unresolvable-алерти, GC) виконується при кожному wake. Сортування черги `waiting`: leaf nodes → `deadline` → `created_at`.

### Протокол подій

Контракт клієнт↔хост. `PROTOCOL_VERSION = 3` (v1/v2 — історія scaffold-spec; несумісні версії → явна помилка з підказкою оновитись).

#### Envelope

```
Envelope {
  seq: u64                    // монотонний у межах run; призначає тримач claim
  ts: DateTime<Utc>
  node_hash: string           // кімната/адреса вузла
  run_token: uuid             // = token claim-а; ідентифікатор сесії
  device_id: uuid?            // хто ініціював (для подій від клієнтів)
  account_id: uuid?           // у спільних задачах учасників кілька
  event: Event
}
```

`session.jsonl` — це append-only список Envelope-ів (крім ефемерних: `PreviewScreenshot`, `AgentTextDelta` можна не журналити — журналиться `AgentTextDone`-агрегат).

#### Events

```
// клієнт → хост
UserMessage      { text, attachments[], surface?: string }
                 // surface-hint: "designer" | "writer" | "cli" | … —
                 // агент може підставити відповідний профіль провайдера/промпт
ContextSelected  { kind: string, payload: json, bounding_box?: Rect }
                 // "dom_element" | "text_range" | "file_region" | … —
                 // контекст, у який «тицьнув» користувач, незалежно від додатку
ApprovalResponse { request_id, approved, signature: bytes }
                 // Ed25519-підпис пристрою над (request_id, approved, node_hash, run_token);
                 // пристрій може належати ІНШОМУ акаунту з роллю approver+
CancelTurn       {}

// хост → клієнти
AgentTextDelta   { text }
AgentTextDone    {}
ToolCall         { call_id, name, args }
ToolResult       { call_id, ok, summary }
ApprovalRequest  { request_id, action, diff? }
PreviewScreenshot{ ref_id, mime }     // ЕФЕМЕРНА: лише relay/WS, ніколи в git;
                                      // лише клієнтам з capability "preview"
FileChanged      { path }
Committed        { commit_hash, message }
NodeState        { path, state, claim?: {holder_device, lease_until, generation} }
                 // derived-стан вузла — і для сесії, і для mt-dashboard
ClaimChanged     { node_hash, holder_device_id?, lease_until?, generation }
                 // транслюється relay-ем; джерело істини — git ref
MemberChanged    { account_id, role? }   // None = видалено
PlanReview       { plan_ref }            // composite-план чекає approve
AuditPending     { fact_ref }            // fact чекає вердикту людини-аудитора
Error            { message }
```

#### Хендшейк

```
ClientHello {
  protocol_version, device_id, device_token,
  client_kind: "designer" | "writer" | "cli" | "mobile" | "mt-dashboard" | …,
  client_capabilities: ["preview", "approvals", "diff_view", …],
  want_replay_from: Option<seq>,
}
→ ServerHello { protocol_version, session_list }
```

Сервер **фільтрує події за capabilities** (PreviewScreenshot → лише "preview"). Реплей: live-хвіст з пам'яті (буфер), глибше — з `session.jsonl` run ref-а.

#### `mt-dashboard`

Спеціалізований `client_kind`: підписується не на один run, а на **піддерево вузлів** (кімнати за node_hash); отримує `NodeState`/`ClaimChanged`/`PlanReview`/`AuditPending`/`Committed` без чат-стріму. Це відповідь на «бачити весь граф як одну картину»: агрегація на клієнті, а не окремий тип сесії.

### Інтерактивна сесія = run вузла

Життєвий цикл:

```
mt attach <node>  (або UI «відкрити задачу»)
  → хост: CAS claim (interactive: true) → worktree від base_sha
  → клієнти підключаються (локально/через relay), отримують реплей
  → кожен хід: UserMessage → агент → ToolCall/ApprovalRequest/…
      → коміт (файли + session.jsonl) → push run ref
  → завершення:
      mt done  → ## Check → fenced publish fact у main (+ archive ref)
      пауза    → renewal припиняється → claim спливає → вузол waiting/stalled
      handoff  → міграція на інший хост (нижче)
```

Інтерактивний режим впливає на політики: `progress_timeout_sec` не діє (людина думає), бюджети радше soft-alert ніж kill; `run_NNN.md` пишеться так само (телеметрія wall_sec/tokens/cost — з ходів).

**Вузол у два режими:** та сама задача може почати як автономна (класичний MT) і бути «підхопленою» в чат (людина відкриває failed-вузол інтерактивно — це новий run з тим самим контрактом), і навпаки: інтерактивно розпочату задачу можна лишити автономному retry.

### Міграція сесії між хостами («перенести сюди»)

```
1. Новий хост (роль host+, git-доступ): шле через relay HandoffRequest{node_hash}
2. Тримач claim: завершує поточний хід → коміт + push run ref
   → пише run_NNN.md (result: handoff) → CAS-delete claim → ack
3. Новий хост: CAS-create claim (новий token, generation+1)
   → fetch старого run ref → worktree checkout з його tip
   → реплей session.jsonl → продовжує розмову (run N+1, журнал успадковано)
4. Relay недоступний / тримач мертвий → шлях MT: чекати lease expiry + grace
   → takeover; журнал відновлюється з останнього запушеного run ref
   (втрачається щонайбільше незавершений хід)
```

Клієнти при цьому не перепідключаються нікуди вручну: relay транслює `ClaimChanged`, клієнти продовжують у тій самій кімнаті з новим активним хостом.

### Preview — capability-based модуль

Прев'ю — опційний модуль інтерактивного run, вмикається за типом проєкту:

- `PreviewBackend { start(worktree) → PreviewHandle }`; референс — `HtmlPreview`: статичний HTTP-сервер над worktree + інжект picker-скрипта + WebSocket live reload (watcher) + ендпоінт, що транслює вибір елемента як `ContextSelected { kind: "dom_element" }`;
- `PreviewScreenshot` шириться лише клієнтам із capability `"preview"`; ніколи не персиститься;
- Інші поверхні шлють свої `ContextSelected` (text_range, file_region) напряму через транспорт.

---

## Частина IV — Люди, пристрої, доступ

### Акаунти, пристрої, ключі

- Користувач логіниться на relay (email + passkey); relay знає всі пристрої акаунта та їх presence. Zero-knowledge не вимагається.
- Кожен пристрій має **Ed25519 keypair**; приватний ключ — у платформозалежному keystore. Пристрій реєструється на relay: `{name, role: host|client, pubkey}` → `device_token`.
- **Підписані approvals** — криптографічний audit trail деструктивних дій, включно з мультипартійним сценарієм (апрув від пристрою іншого учасника).

### Relay: обов'язки і межі

Координатор. Персистентне — лише акаунти/membership/запрошення; решта ефемерне.

| Робить | НЕ робить |
| --- | --- |
| auth акаунтів/пристроїв | не зберігає журнали сесій |
| membership задач + запрошення | не проксіює git |
| presence (хости: hostname, проєкти, активні вузли) | **не видає lease** (істина — git claim) |
| пересилка Envelope по кімнатах-вузлах | не парсить payload далі роутінгових полів |
| трансляція ClaimChanged, HandoffRequest | не виконує агентів |
| буфер останніх ~200 Envelope на run (live-хвіст) | |
| push «нові події» / «запрошення» / «потрібна увага» | |
| роздача pubkey-ів учасників (для перевірки підписів) | |

Rate limit на з'єднання; ліміт кадру. Схема даних:

```sql
accounts(account_id, email, display_name, …)
devices(account_id, device_id, role, pubkey, last_seen)
tasks(root_node_hash, owner_account, project_name, remote_url, created_at)
task_members(root_node_hash, account_id, role, invited_by, joined_at)
  -- role: owner | host | approver | viewer; owner створюється автоматично
invitations(invitation_id, root_node_hash, from_account, to_email, role, status, created_at)
  -- status: pending | accepted | declined | revoked
```

**Membership прив'язане до кореневого вузла задачі** (`mt init`-root) і успадковується всім піддеревом. Кімната relay = вузол; підписка дозволена лише пристроям акаунтів-учасників кореня.

### Ролі і мапінг на MT-акторів

| Роль relay | git-доступ | Права у графі |
| --- | --- | --- |
| **owner** | так (precondition) | усе + запрошення, зміна ролей, transfer ownership |
| **host** | так (precondition) | тримати claim (runner/сесія), `mt run/done/audit/spawn`, handoff |
| **approver** | **не потрібен** | підписувати ApprovalResponse: mid-run tool approvals, plan-review, аудит-вердикти |
| **viewer** | **не потрібен** | лише стрічка подій (relay відхиляє клієнтські події viewer-а, включно з CancelTurn) |

- Relay-роль ↔ MT: `actor: human` у `h.md` — це учасник із будь-якою роллю, чий handle = `assignee`; `actor: engineer/auditor` — агентні ролі хоста; людина-аудитор потребує `approver+`.
- **Precondition git-доступу:** щоб учасник із роллю host підняв задачу на своїй машині, його git-креденшели мають мати доступ до remote — це відповідальність git-хостингу (GitHub/GitLab/Gitea); relay git не проксіює. Approver і viewer git-доступу не потребують — їм досить стрічки подій.

**Membership API relay:** `invite {email, role}` (owner; push отримувачу або pending до реєстрації) → `accept/decline` (accept → запис у task_members + broadcast MemberChanged) → `PATCH role` / `DELETE` (owner) → `transfer ownership`. `GET pubkeys` — pubkey-и пристроїв учасників `approver+`; доступ лише пристроям учасників.

### Approvals: три гейти, один механізм

| Гейт | Тригер | Матеріалізація у git |
| --- | --- | --- |
| **Mid-run tool approval** | деструктивний ToolCall (edit поза worktree-політикою, merge, деплой…) → `ApprovalRequest` | рядок у `## Approvals` відповідного `run_NNN.md` |
| **Plan-review** | composite `plan_NNN.md` → подія `PlanReview` | `plan-approved/rejected_NNN.md` з блоком `approved_by` |
| **Аудит-вердикт людини** | `pending-audit` + аудитор-людина → `AuditPending` | `audit-result_NNN.md` з блоком підпису |

Потік однаковий: хост шле запит у кімнату → будь-який пристрій учасника з роллю `approver+` підписує `(request_id, approved, node_hash, run_token)` власним ключем → хост звіряє підпис із pubkey-кешем (запит до relay, кеш із TTL; підпис поза списком → відмова + `Error`) → матеріалізує у файл вузла → fenced publish. Ключовий сценарій: телефон учасника B апрувить деструктивну дію задачі акаунта A, не маючи жодного git-доступу.

Очікування approval = стан `WaitingApproval` run-а; timeout → хід скасовується (політика per-node).

### Push-нотифікації

Relay шле мобільним/десктопним пристроям data-повідомлення трьох типів:

1. «нові події у задачі X» (розбудити клієнт/хост);
2. «вас запрошено у задачу X»;
3. «задача X потребує уваги» — `unresolvable`, `plan-review`, `pending` для `h.md`-assignee (`notify: true`), `AuditPending`.

Тип 3 закриває дірку базового MT, де notify був заглушкою.

---

## Частина V — Експлуатація

### CLI контракт

Конфіг: `MT_DIR` env або `.mt.json` → `mt_dir`, дефолт `./mt/`. Всі команди — `--json`.

```
# ядро графа (без змін відносно 0.2.0)
mt setup | init | plan | status | scan | run | kill | invalidate |
   done | audit | failed | spawn | stop | cleanup | watch

# хост і сесії (НОВЕ)
mt serve [--relay wss://…]        ← headless agent-server (always-on машини)
mt attach <node> [--remote]       ← інтерактивна сесія: локальний хост через
                                    port-file або віддалений через relay; REPL
mt handoff <node>                 ← «перенести сюди»: HandoffRequest + claim

# акаунт і учасники (НОВЕ)
mt login                          ← device-flow авторизація на relay
mt sessions                       ← активні run-и акаунта, включно зі спільними
                                    (хто де, хто тримає claim, моя роль)
mt invite <root-node> <email> --role host|approver|viewer
mt members <root-node>
```

`mt watch`/`mt run --auto` зберігаються як однопострільні входи тієї самої логіки, що живе в agent-server (fallback-режим без сервера). Exit codes `mt scan`/`mt watch`: `0` — ок, `1` — є вузли, що потребують уваги.

`mt cleanup [--older-than N]` (дефолт 7 днів): orphan worktrees без active claim, мертві running-маркери, remote orphan run refs (старші `run_ref_ttl_days`), протухлі archive refs (старші `archive_ttl_days`).

### Конфігурація (`.mt.json`)

До конфігурації 0.2.0 (claim/publish/budget/retry/audit/model/skill_profiles — без змін) додаються:

```json
{
  "relay_url": "wss://relay.example.com",
  "server_port_file": "~/.nitra/server.port",
  "device_key_path": "~/.nitra/device.key",
  "interactive_claim_lease_sec": 900,
  "interactive_claim_renew_sec": 60,
  "session_archive": true,
  "archive_ref_prefix": "refs/mt/archive",
  "archive_ttl_days": 90,
  "require_signed_approvals": false,
  "surface_profiles": { "designer": "local-omlx", "writer": "litellm" },
  "provider_profiles": {
    "local-omlx":  { "base_url": "http://127.0.0.1:8080/v1", "model": "…" },
    "local-ollama":{ "base_url": "http://127.0.0.1:11434/v1", "model": "…" },
    "litellm":     { "base_url": "http://…/v1", "model": "…" }
  }
}
```

**Модель провайдера:** `model_map` (MIM/AVG/MAX) і `provider_profiles` — один механізм: tier резолвиться у профіль. Автономні run-и обирають за `model_tier` з `a.md`; інтерактивні можуть перевизначати профіль per-turn за `surface`-hint (`surface_profiles`); за відсутності — профіль сесії. LLM-транспорт — уніфікований provider-інтерфейс (OpenAI-compatible як мінімальний спільний знаменник; конкретика — у stack.md).

Per-node override: `mt/<node>/.mt-override.json`. `schema_version` — перше поле; невідома/відсутня → fail closed.

### Монорепо: множинні `mt/`

```
monorepo/
  mt/            ← глобальний (cross-workspace задачі)
  packages/api/mt/
  .worktrees/    ← завжди в git root
```

`MT_DIR` вказує на конкретний `mt/`; один orchestrator на один root. `mt/` не може бути в `.gitignore`d-директорії; scan пропускає приховані, `node_modules`/`target`/`dist`/`build`.

### Security model

- **Sandbox-профілі:** skill → профіль у `skill_profiles`: allowlist команд, network (off за замовчуванням), fs-scope (worktree). Команда поза allowlist → відмова.
- **Secrets broker:** `a.md` → `secrets: [KEY]`; wrapper інжектить через ENV з OS keychain; маскує у виводах. У файлах вузлів секретів немає.
- **PII:** у git — лише handles; мапінг handle → account у `.mt/directory.json` (git-ignored) та relay.
- **Device keys:** приватні ключі не покидають keystore пристрою; relay зберігає лише pubkeys; компрометація пристрою → видалення device з relay (підписи перестають прийматись негайно завдяки pubkey-кешу з TTL).
- **ACL:** relay — «хто і кому можна» (membership, кімнати); git-хостинг — доступ до remote; жодних списків доступу у файлах вузлів.
- **Read-scope:** агент читає файли будь-яких вузлів свого `mt/` (trade-off); ізоляція — окремий `mt/`/remote на команду чи тенанта.

### Відмовостійкість

| Відмова | Поведінка |
| --- | --- |
| Relay недоступний | хости працюють: claim/publish/scan через git; wake — cron fallback; віддалені клієнти і push тимчасово недоступні; локальні клієнти працюють через WS/in-process |
| Хост помер посеред сесії | claim спливає → stalled → takeover іншим хостом; журнал відновлюється з останнього запушеного run ref (втрата ≤ 1 незавершеного ходу) |
| Git remote недоступний | інтерактивна сесія продовжується локально (коміти накопичуються), push ретраїться; done/handoff блокуються до відновлення |
| Клієнт від'єднався | нічого: сесія живе на хості; реконект → реплей з `want_replay_from` |

### Bootstrap

```bash
# Передумови: branch protection на main; relay розгорнутий (опційно для соло-локального)
mt setup            # .mt.json + .mt/system-prompt.md + mt/ + git hook; fail closed без protection
mt login            # реєстрація пристрою на relay (пропустити для offline-режиму)

mt init my-project --task "..." --mode agent --budget-sec 3600
mt run mt/my-project/        # автономно — або:
mt attach mt/my-project/     # інтерактивно з будь-якої поверхні
```

### Наскрізні сценарії (Definition of Done архітектури)

1. **Автономний headless (класичний MT):** init → watch → plan (composite) → spawn --approve → діти паралельно → аудит із clarification → composite-агрегація → resolved. Без relay, без клієнтів.
2. **Мультихост, один акаунт:** хост A (`mt serve`) веде інтерактивну сесію → користувач на машині B робить «перенести сюди» → handoff: B продовжує ту саму розмову з повною історією; спроба писати без claim → відхилено CAS-ом.
3. **Спільна задача, два акаунти:** A створює задачу → запрошує B (`approver`) → телефон B отримує стрічку і підписує ApprovalResponse → хост A звіряє підпис pubkey-єм пристрою B → виконує деструктивну дію → підпис видно у `run_NNN.md ## Approvals`. Потім роль B → `host` → B робить handoff і веде задачу далі; підписка стороннього акаунта на кімнату → відмова relay.
4. **Dashboard:** `client_kind: "mt-dashboard"` підписується на піддерево → бачить live `NodeState`/`PlanReview`/`Committed` усього графа; апрув плану з телефона → `plan-approved_NNN.md` з підписом.
5. **Деградація:** вимкнути relay посеред сценарію 2 → сесія на активному хості триває; handoff можливий через expiry+grace takeover; після повернення relay presence/push відновлюються.

---

## Changelog

### 0.3.0-draft — 2026-07-07

Об'єднання `mt.md` 0.2.0 (граф задач) та scaffold-spec v4 (пристрої/сесії) в одну архітектуру:

- git CAS claim — єдине «перо» для автономних і інтерактивних режимів; relay lease видалено з протоколу (relay лише нотифікує `ClaimChanged`);
- інтерактивна сесія = run вузла: `session.jsonl` у run ref з push-ом кожен хід; archive refs; `result: handoff`; протокол міграції між хостами;
- agent-server: один хост-процес на машину (orchestrator + runner + session host), discovery через port-file; relay push замість cron-polling (cron — fallback);
- протокол подій v3: Envelope/Event, ClientHello з `client_kind`/`client_capabilities`, `ContextSelected`, `surface`-hint, `mt-dashboard`;
- Ed25519-підписи пристроїв на трьох гейтах (mid-run approvals → `## Approvals` у `run_NNN.md`; plan-review і аудит-вердикти → блок `approved_by`); pubkey-кеш через relay;
- membership-модель (owner/host/approver/viewer) на кореневому вузлі задачі, ACL у relay; precondition git-доступу для host+; push-нотифікації (3 типи) замість notify-заглушки;
- `interactive: true` у claim/`a.md`; `surface_profiles`/`provider_profiles` у конфігу; нові CLI: `mt serve/attach/handoff/login/sessions/invite/members`;
- стек винесено в окремий документ stack.md.

### 0.2.0 — 2026-06-11

Початкова версійована редакція контракту MT (`@7n/mt@0.2.0`) — див. `mt.md`.
