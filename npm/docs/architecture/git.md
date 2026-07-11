---
type: architecture
description: 'CAS claim як єдине «перо», run ref із журналом сесії, fenced publish і паралельне виконання'
tags: [git, claim, lease, publish]
timestamp: 2026-07-07
---

# Координація через git

> Частина цільової архітектури **0.3.0-draft** — [зміст](index.md) · [огляд](overview.md)

## Claim — авторитетне «одне перо»

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

## Run ref і журнал сесії

Run ref: `refs/mt/runs/<node-hash>/<token>` — гілка робочого стану поточної спроби.

- **Автономний run:** wrapper оновлює run ref на власний розсуд (мінімум — на завершення); run ref потрібен для debug і fenced publish.
- **Інтерактивний run (ЗМІНЕНО):** **кожен хід** (turn) = коміт у worktree (правки файлів + append у `.nitra/session.jsonl`) + **негайний push run ref**. Це і є механізм міграції між пристроями, відновлення після смерті хоста та handover іншому користувачу. `session.jsonl` — event log розмови (Envelope-и — див. [runtime.md](runtime.md)); `.nitra/state.json` — метадані (курсор, профіль провайдера). Ані `.nitra/`, ані скріншоти **ніколи** не потрапляють у `main`.

**Архів сесії:** при publish run ref видаляється (як у базовому MT), але якщо `session_archive: true` — журнал зберігається у `refs/mt/archive/<node-hash>/<NNN>` (GC за `archive_ttl_days`), а `run_NNN.md` отримує поле `session_archive:`.

**Checkpoint-handoff (приватність передачі).** Звичайний handoff передає run ref разом із повним `session.jsonl` — всі чорнові репліки. Для передачі стороннім є режим «з checkpoint»: тримач пише `run_NNN (result: handoff)` і **свіжий run ref**, що містить лише стан worktree + дистильований summary останніх ходів, без журналу розмови; повний `session.jsonl` іде в archive ref, видимий лише авторові. Приймач продовжує з чистого контексту (run N+1). Вибір режиму — параметр `mt handoff --checkpoint` / політика per-node.

## Wrapper: запуск агента

**Wrapper** (`mt run`; у цільовій картині — роль Runner всередині agent-server): перевіряє deps resolved + відсутність pending-audit → CAS claim → detached worktree від `base_sha` → run ref → запускає агента → watchdog → пише `run_NNN.md` → publish.

**ENV-контракт wrapper → агент:** `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, `MT_RUN_NNN`, `MT_ATTEMPT`, `MT_CLAIM_TOKEN`, `MT_CLAIM_GENERATION`. `MT_CLAIM_GENERATION` — fencing token для non-idempotent side effects: single publish owner гарантує лише один запис результату в `main`, не mutual exclusion виконання.

## Fenced publish

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

## Паралельне виконання

Незалежні вузли — паралельно, кожен у своєму git worktree (path унікальний через token). **Remote publish = межа атомарності:** наступник стартує лише після resolved попередника. Конфлікт злиття = звичайний `failed` → EngineerAgent. `agent_concurrency` лімітує active agent claims (людські не рахуються).
