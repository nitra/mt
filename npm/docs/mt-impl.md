# MT: Посібник з реалізації

Супровідний документ до [`mt.md`](mt.md). Містить деталі реалізації, покрокові алгоритми та аналіз трейдофів — те, що виходить за межі нормативного контракту специфікації.

---

## Наскрізний приклад

Соло-розробник + один аналітик. Задача: дослідити аномалії платежів Q4.

**1. Ініціалізація.**

```bash
mt init quarterly-anomalies --task "Дослідити аномалії платежів Q4" --mode agent --budget-sec 3600
```

→ `mt/quarterly-anomalies/task.md` + `a.md`. Людина доповнює `## Done when` і `## Check` (`bun test reports/`); зміни йдуть у `main` через fenced publish.

**2. Inline-план → composite.** Watch бачить `waiting` → `mt run`: CAS-claim → worktree → агент не знаходить плану → пише `plan_001.md` (decision: composite):

```yaml
children:
  - id: collect-data
    mode: agent
    model_tier: AVG
    budget_sec: 1800
    deps: []
    task: Зібрати платіжні дані Q4 з API
  - id: analyze
    mode: agent
    audit: required
    deps: [collect-data]
    task: Знайти аномалії у зібраних даних
  - id: review-findings
    mode: human
    qualification: senior analyst
    deps: [analyze]
    task: Перевірити знахідки і підтвердити висновки
```

Run завершується `result: decomposed` → вузол у `plan-review`.

**3. Approve.** Людина: `mt status` → `plan-review` → `mt spawn --approve mt/quarterly-anomalies/`. Валідація `## Children` (naming, mode per-child, deps, цикли) → матеріалізація трьох дітей (`task.md` + `a.md`/`h.md` + `deps/`) + `plan-approved_001.md` — один commit. Батько → `spawned`.

**4. collect-data — щасливий шлях.** Watch → claim → inline `plan_001` (atomic) → агент збирає дані → `fact_001.md` (`ref: data/q4-raw.json`) → `mt done` → `## Check` pass → wrapper: `run_001` (success, `wall_sec`, `cost_usd`) → fenced publish → `resolved`.

**5. analyze — retry ladder + аудит.** Dep задоволений → claim → спроба 1 падає (`mt failed`; run-draft дав `## Blockers`) → `run_001` (failed), `failed_streak = 1 < agent_retry_max` → вузол лишається `waiting`. Retry `MT_ATTEMPT=2` (поза diagnose-first + Prior attempts) → успіх: `fact_002.md`; вузол має `audit: required` → `mt audit` → `## Check` pass → `pending-audit_002.md` → publish. Стан `pending-audit` — **review-findings чекає** (блокуючий гейт: dep не `resolved`).

**6. Аудит з уточненням.** Watch → `mt run --actor auditor` (`audit_model: auto` = tier виконавця). Аудитор сумнівається → `clarification_002.md` (не вердикт) → watch → `mt run --actor agent --amend` → `amended_002.md` → повторний аудит → `audit-result_002.md` (success) → analyze `resolved`.

**7. Людський вузол.** review-findings → `pending`, notify контакту `assignee`. Людина: `mt run mt/quarterly-anomalies/review-findings/ --actor human` (claim з добовим lease) → перевіряє → `fact_001.md` → `mt done` → `resolved`.

**8. Composite-агрегація.** Останній `mt done` → wrapper: усі діти `resolved` → синтетична пара у батька — `run_001` (actor: wrapper) + `fact_001`:

```markdown
## Summary

Зібрано 12 480 платежів Q4, знайдено і підтверджено 3 аномалії.

## children

- collect-data: ref: collect-data/fact_001.md
- analyze: ref: analyze/fact_002.md
- review-findings: ref: review-findings/fact_001.md
```

Батько `resolved` — граф завершено. Підсумковий стан:

```
mt/quarterly-anomalies/
  task.md  a.md  plan_001.md  plan-approved_001.md
  run_001.md  fact_001.md             ← синтетична пара (actor: wrapper)
  collect-data/    task.md  a.md  plan_001.md  run_001.md  fact_001.md
  analyze/         task.md  a.md  deps/quarterly-anomalies/collect-data.md  plan_001.md
                   run_001.md (failed)  run_002.md  fact_002.md
                   pending-audit_002.md  clarification_002.md  amended_002.md  audit-result_002.md
  review-findings/ task.md  h.md  deps/quarterly-anomalies/analyze.md  run_001.md  fact_001.md
```

---

## Wrapper: покрокова реалізація

### Звичайний запуск (`mt run <path> [--actor agent|engineer|human]`)

1. Читає `task.md` → `budget_sec`, `budget_hard_sec`, `deadline`; читає `a.md`/`h.md` → mode, `model_tier`, `skills`/`qualification`.
2. `ls -R deps/` → strip `.md` → абсолютний dep-id; перевіряє що всі deps у стані `resolved`. Dep з відкритим аудитом (`pending-audit`) → `blocked`, exit без запуску; dep без `fact_*.md` → `blocked-invalid-dep`, exit з помилкою.
3. Перевіряє: є `pending-audit_*.md` без `audit-result_*.md` → exit з помилкою "audit pending, retry blocked".
4. `git fetch origin main` і atomic claim acquisition:
   - claim відсутній → create-only CAS push
   - active claim існує → skip
   - expired claim → takeover лише після grace через exact-SHA CAS
5. Після accepted claim — detached worktree від `base_sha` (не checkout `main`):

   ```bash
   git worktree add --detach .worktrees/<node-hash>-<token> <base_sha>
   git push origin HEAD:refs/mt/runs/<node-hash>/<token>
   ```

   > **Унікальність worktree path.** `<token>` — UUID4 при кожному claim create/takeover. Два runner-и не можуть отримати однаковий token: перший CAS виграє, другий робить takeover і отримує новий UUID. Worktrees попередніх спроб залишаються за іншим шляхом і не конфліктують.

6. Пише `running_<pid>_until_<lease_until>` і запускає lease renewal кожні `claim_renew_sec`. Renewal — новий claim commit з parent = current claim SHA, оновлення ref через CAS.
7. Визначає NNN = `count(run_*.md) + 1` і `failed_streak`; обирає щабель retry ladder за `MT_ATTEMPT = failed_streak + 1`.
8. Запускає агента (cwd = worktree):

   ```
   MT_BUDGET_SEC=<sec> MT_HARD_BUDGET_SEC=<sec> \
   MT_STARTED_AT=<unix> MT_RUN_NNN=<NNN> MT_ATTEMPT=<failed_streak+1> \
   MT_CLAIM_TOKEN=<token> MT_CLAIM_GENERATION=<generation> \
   claude --system-prompt .mt/system-prompt.md \
          --message "solve task at task.md"
   ```

   Агент обчислює залишок: `remaining = started_at + budget_sec - now()`.

9. Polling worktree кожні 5 сек:
   - немає `mtime`-змін > `progress_timeout_sec` → SIGKILL + `result: progress-timeout`
   - elapsed > `budget_hard_sec` → SIGKILL + `result: budget-exceeded`
   - renewal rejected або claim token змінився → SIGTERM + `result: claim-lost`; publish заборонено

10. Після виходу агента:
    - є `fact_NNN.md` → `run_NNN.md` (success) + `## Ref → fact_NNN.md`
    - є composite-план без fact → `result: decomposed` → `plan-review`
    - інакше → `result: failed` або kill-причина; секції з `run-draft.md`, fallback — телеметрія

11. `success`/`decomposed` → fenced publish → видаляє marker/worktree → `touch .mt/wake`.
12. Failure-сімейство: `run_NNN.md` публікується окремим fenced push; run ref/worktree лишається для debug; claim звільняється CAS-delete (якщо runner досі ним володіє).

### Запуск аудитора (`mt run --actor auditor <path>`)

1. Перевіряє `pending-audit_NNN.md` без `audit-result_NNN.md` у main.
2. Claim-ить audit operation тим самим CAS-протоколом; окремий audit run ref від `base_sha`.
3. Spawns auditor subprocess.
4. Чекає виходу → аудитор пише `audit-result_NNN.md` або `clarification_NNN.md`.
5. `clarification_NNN.md` → fenced publish → чекає `amended_NNN.md`. Інакше:
   - `success` → fenced publish → `touch .mt/wake`
   - `failed` → рахує `audit-result_*.md (result: failed)` у main: < `audit_retry_max` → fenced publish → `waiting` (rework); ≥ `audit_retry_max` → worktree залишається, watch ескалює.

---

## Protected main та integration bot

Для protected `main` runner не отримує bypass. Він:

1. Створює integration branch із commit, на який вказує run ref.
2. Відкриває PR із claim token у metadata — **виключно як approval interface**.
3. Сам у `main` не пише — це справа integration bot.

**Виявлення approved PR — implementation concern поза MT-протоколом.** Reference implementation: GitHub Actions triggered on `pull_request_review` (state `approved`) → bot виконує fenced push. Альтернативи: webhook → queue → bot; polling GitHub API.

Integration bot:

1. Читає commit SHA з run ref, перевіряє exact claim SHA/token.
2. Виконує той самий fenced atomic push (не GitHub Merge API):

   ```bash
   git push --atomic \
     --force-with-lease=refs/heads/main:<expected-main-sha> \
     --force-with-lease=refs/mt/claims/<node-hash>:<claim-sha> \
     --force-with-lease=refs/mt/runs/<node-hash>/<token>:<run-sha> \
     origin \
     <result-sha>:refs/heads/main \
     :refs/mt/claims/<node-hash> \
     :refs/mt/runs/<node-hash>/<token>
   ```

3. Після успішного push видаляє integration branch і закриває PR. Push відхилено → той самий backoff що й direct publish.

Bot identity отримує "bypass branch protection" виключно для цього push; прямий push людей/агентів заборонено.

**Git hook** (`.git/hooks/post-merge`):

```bash
#!/bin/sh
mt run --auto
touch .mt/wake
```

---

## mt watch: повна логіка

**Поточна реалізація:** periodic rescan раз на 5 хвилин або по `touch .mt/wake`. Не persistent daemon.

**При кожному скані:**

- `git ls-remote origin 'refs/mt/claims/*'` → authoritative список active/stalled claims
- Для локальних claims: `kill -0 <pid>`; мертвий process не звільняє claim без CAS-delete
- Expired claims (`lease_until + claim_grace_sec ≤ now()`) → попередження або CAS-takeover
- `pending-audit_NNN.md` без `audit-result_NNN.md`:
  - немає clarification → `mt run --actor auditor`
  - є `clarification_NNN.md` без `amended_NNN.md` → `mt run --actor agent --amend`
  - є amended → повторний `mt run --actor auditor`
- `failed` вузли (`failed_streak ≥ agent_retry_max`, без active claim) → `mt run --actor engineer`
- Вузли з вичерпаними лімітами (streak ≥ `agent_retry_max + engineer_retry_max` або `sum(wall_sec) > budget_total_sec`) → `unresolvable.md` + алерт
- `count(plan-rejected_*.md) ≥ plan_reject_max` → `unresolvable.md` (причина: plan disagreement) + алерт
- Orphan run refs без active claim → пропонує explicit resume або cleanup; автоматичний publish заборонено
- GC: failure run refs старші за `run_ref_ttl_days` → видаляє remote ref. Success refs видаляються одразу при `mt done` (atomic push); watch GC покриває лише failure/orphan.
- `mt done <child>` → wrapper перевіряє siblings → всі resolved → пише run+fact батька → рекурсивно вгору
- `pending` (h.md) → нагадування + notify `assignee`
- `unassigned` (немає a.md/h.md) → нагадування
- `plan-review` → skip (чекають approve)
- Правило легітимності: вузол не в `## Children` approved-плану батька і не кореневий → `orphan-node` warning

**TODO (майбутній daemon):**

| Умова                                                 | Повідомлення                 |
| ----------------------------------------------------- | ---------------------------- |
| `pending` (h.md) > `stale_worktree_min` хв            | потрібна участь людини       |
| ≥ 3 поспіль `audit-result: failed`                    | audit loop — потрібна людина |
| вузол → `unresolvable`                                | спроби вичерпано             |
| `stalled` (claim + grace минули)                      | потрібен takeover            |
| граф blocked (всі `unassigned`/`pending`/failed-deps) | граф заблокований            |
| вільне місце < `min_free_disk_gb`                     | disk space alert             |

---

## Контракт для моніторингу

Скрипт відновлює durable стан графу скануванням файлів, runtime ownership — скануванням remote claim refs:

```
git ls-remote origin 'refs/mt/claims/*'

для кожного mt/**/task.md:
  визначити durable стан (які файли існують поруч)
  зіставити node-hash з active/stalled claim
  визначити залежності: ls -R deps/ → strip .md → абсолютний dep-id
  зібрати run_NNN.md, fact_NNN.md, plan_NNN.md, pending-audit_NNN.md, audit-result_NNN.md

вивести:
  - дерево вузлів зі станами
  - failed: run_*.md без fact_*.md, streak ≥ agent_retry_max, без active claim
  - pending (h.md) або unassigned (немає a.md/h.md)
  - pending-audit: є pending-audit без audit-result
  - active/stalled claims та runner_id
  - локальні worktrees і remote run refs
  - waiting: очікують виконання
```

---

## SWOT-аналіз

### Сильні сторони

- **Інкапсуляція:** батько не знає що всередині — замінюваність без змін у батьківському графі
- **Файловий стан:** безкоштовна персистентність, відновлення після збоїв, повний аудит через git history
- **Immutable + numbered:** будь-який збій відновлюється скануванням `run_*.md`/`fact_*.md`
- **LLM-first формат:** `run_NNN.md` — інженер читає і продовжує природно
- **Git-backed ownership:** atomic CAS claim не дозволяє двом host одночасно володіти вузлом
- **Fenced publish:** runner без актуального claim token не може опублікувати результат
- **Git-native паралельність:** worktree — вже знайомий інструмент
- **Симетрія:** конфлікт злиття = вузол що впав — той самий патерн відновлення
- **Часовий бюджет** замість лічильника — реалістичне обмеження
- **Audit-трек окремо:** `audit-result_NNN.md` не засмічує `run_NNN.md` виконавців

### Слабкі сторони

- **Scan без індексу:** при великих графах сканування всіх `task.md`/`deps/` — дорого
- **Drift намірів:** після N патчів оригінальна місія розмивається (частково: незмінний `## Task`)
- **Merge conflict** вимагає engineer-втручання — same as будь-який failed вузол
- **Масштаб worktree:** жорсткий ліміт на MacBook обмежує реальну паралельність
- **Main — точка серіалізації:** publish-и мержаться послідовно; батчинг + backoff пом'якшують контеншн, але >~10 publish/хв → черга росте

### Можливості

- `run_NNN.md` накопичує знання — дистиляція в кращі промпти майбутніх агентів
- Git history = безкоштовний time-travel debugging всього графу
- Файлова система може бути розподіленою (NFS, S3) — горизонтальне масштабування
- Інкрементальний індекс-кеш для scan (інвалідація по git diff) — знімає слабкість без зміни файлових контрактів
- Природна інтеграція з CI/CD через git hooks

### Загрози

- **Cascade при зміні кореня:** інженер інвалідує весь граф і не вкладається у бюджет — система стоїть
- **LLM недетермінізм:** той самий вузол розкладається по-різному при перезапуску — ускладнює debugging
- **Remote недоступний:** GitHub down → claim/publish неможливі; локального fallback немає (один source of truth)
- **Lease clock skew:** host з неправильним часом може передчасно вважати claim expired; exact-SHA CAS не допускає двох owner одночасно, але може передати ownership раніше очікуваного — потрібні NTP і консервативний `claim_grace_sec`
