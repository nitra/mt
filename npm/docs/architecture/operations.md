---
type: architecture
description: 'CLI-контракт, конфігурація, монорепо, security model, відмовостійкість, bootstrap і наскрізні сценарії'
tags: [operations, cli, config, security, scenarios]
timestamp: 2026-07-07
---

# Експлуатація

> Частина цільової архітектури **0.3.0-draft** — [зміст](index.md) · [огляд](overview.md)

## Суть

Цей документ описує архітектурний контракт для експлуатації системи, визначаючи чіткий інтерфейс командного рядка та конфігурації. Він гарантує надійну роботу в різних режимах — від повністю автономних до інтерактивних сесій з підтримкою кількох користувачів. Система спроектована для високої відмовостійкості, забезпечуючи неперервність процесу навіть при збої комунікаційних сервісів. Ключовими рішеннями є механізми безпеки, ізоляції та масштабування для підтримки складних, довготривалих завдань.

## CLI контракт

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

# повторювані задачі (НОВЕ)
mt template list                  ← шаблони + наступне спрацювання + останній інстанс
mt template run <name>            ← позачергова матеріалізація (occurrence = now)
```

`mt watch`/`mt run --auto` зберігаються як однопострільні входи тієї самої логіки, що живе в agent-server (fallback-режим без сервера). Exit codes `mt scan`/`mt watch`: `0` — ок, `1` — є вузли, що потребують уваги.

`mt cleanup [--older-than N]` (дефолт 7 днів): orphan worktrees без active claim, мертві running-маркери, remote orphan run refs (старші `run_ref_ttl_days`), протухлі archive refs (старші `archive_ttl_days`), resolved-інстанси шаблонів понад `keep` ([recurrence.md](recurrence.md)).

## Конфігурація (`.mt.json`)

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
  "surface_profiles": { "designer": "pi", "writer": "codex" }
}
```

Конфігурація **виконавців** (провайдери/моделі) — не тут: вона user-level, спільна для всіх репозиторіїв, і живе в ENV (`MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`, `MT_AGENT_CLI_MODEL_MAP` — [runtime.md](runtime.md#підписочні-cli-виконавці-agent_cli)). `.mt.json` — виключно repo-scoped.

**Модель виконавця:** канон тирів MIN/AVG/MAX резолвиться у конкретну модель обраного CLI через env `MT_AGENT_CLI_MODEL_MAP` ([runtime.md](runtime.md#підписочні-cli-виконавці-agent_cli)). Автономні run-и обирають за `model_tier` з `a.md`; інтерактивні можуть перевизначати CLI per-turn за `surface`-hint (`surface_profiles`). Транспорт AI-викликів — виключно **ACP** (конкретика — у [stack.md](stack.md)).

Per-node override: `mt/<node>/.mt-override.json`. `schema_version` — перше поле; невідома/відсутня → fail closed.

Baseline-ключі 0.2.0 з конкретними дефолт-значеннями канонічно живуть у коді (`CONFIG_DEFAULTS` у `mt-core`, обгортка `npm/lib/core/config.mjs`; згенерований довідник — `npm/lib/core/docs/config.md`); глави документують семантику ключів — мапа нижче.

### Довідник ключів (де що описано)

| Група ключів | Ключі | Глава |
| --- | --- | --- |
| Розташування | `mt_dir` (`MT_DIR` env) | тут |
| Бюджети/watchdog | `budget_sec`, `budget_hard_sec(_multiplier)`, `budget_total_sec`, `progress_timeout_sec`, `deadline` | [graph.md](graph.md) |
| Retry/ескалація | `agent_retry_max`, `engineer_retry_max`, `plan_reject_max`, `retry_ladder`, `run_summary_threshold` | [graph.md](graph.md) |
| Аудит | `audit`, `audit_model`, `audit_retry_max`, `audit_schedule_days`, `audit_on_patch`, `clarification_timeout_sec` | [graph.md](graph.md) |
| Claim/lease | `claim_grace_sec`, `claim_renew_sec`, `interactive_claim_lease_sec`, `interactive_claim_renew_sec` | [git.md](git.md), [runtime.md](runtime.md) |
| Publish/refs | `publish_retry_base_ms`, `publish_retry_max`, `run_ref_ttl_days`, `session_archive`, `archive_ref_prefix`, `archive_ttl_days` | [git.md](git.md) |
| Паралелізм | `agent_concurrency` | [git.md](git.md) |
| Виконавці/моделі | ENV: `MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`, `MT_AGENT_CLI_MODEL_MAP` | [runtime.md](runtime.md), [stack.md](stack.md) |
| Поверхні/тули | `surface_profiles`, `mcp_servers` | [surfaces.md](surfaces.md) |
| Повторюваність | `templates_dir`; per-template `recurrence.md` (`schedule`/`every`, `tz`, `overlap`, `catchup`, `keep`) | [recurrence.md](recurrence.md) |
| Безпека | `skill_profiles` (sandbox), `secrets` (у `a.md`), `require_signed_approvals`, `device_key_path` | тут, [access.md](access.md) |
| Relay/хост | `relay_url`, `server_port_file` | тут, [runtime.md](runtime.md) |
| i18n | `i18n.{base_lang, eager, publish_langs, include, exclude, model_tier, ttl_days}` | [i18n.md](i18n.md) |

## Монорепо: множинні `mt/`

```
monorepo/
  mt/            ← глобальний (cross-workspace задачі)
  packages/api/mt/
  .worktrees/    ← завжди в git root
```

`MT_DIR` вказує на конкретний `mt/`; один orchestrator на один root. `mt/` не може бути в `.gitignore`d-директорії; scan пропускає приховані, `node_modules`/`target`/`dist`/`build`.

## Security model

- **Sandbox-профілі:** skill → профіль у `skill_profiles`: allowlist команд, network (off за замовчуванням), fs-scope (worktree). Команда поза allowlist → відмова.
- **Secrets broker:** `a.md` → `secrets: [KEY]`; wrapper інжектить через ENV з OS keychain; маскує у виводах. У файлах вузлів секретів немає.
- **PII:** у git — лише handles; мапінг handle → account у `.mt/directory.json` (git-ignored) та relay.
- **Device keys:** приватні ключі не покидають keystore пристрою; relay зберігає лише pubkeys; компрометація пристрою → видалення device з relay (підписи перестають прийматись негайно завдяки pubkey-кешу з TTL).
- **ACL:** relay — «хто і кому можна» (membership, кімнати); git-хостинг — доступ до remote; жодних списків доступу у файлах вузлів.
- **Read-scope:** агент читає файли будь-яких вузлів свого `mt/` (trade-off); ізоляція — окремий `mt/`/remote на команду чи тенанта.

## Відмовостійкість

| Відмова | Поведінка |
| --- | --- |
| Relay недоступний | хости працюють: claim/publish/scan через git; wake — cron fallback; віддалені клієнти і push тимчасово недоступні; локальні клієнти працюють через WS/in-process |
| Хост помер посеред сесії | claim спливає → stalled → takeover іншим хостом; журнал відновлюється з останнього запушеного run ref (втрата ≤ 1 незавершеного ходу) |
| Git remote недоступний | інтерактивна сесія продовжується локально (коміти накопичуються), push ретраїться; done/handoff блокуються до відновлення |
| Клієнт від'єднався | нічого: сесія живе на хості; реконект → реплей з `want_replay_from` |

## Межі масштабу (design envelope)

- **Цільовий масштаб — до ~5–10k вузлів на один `mt/`-корінь**: scan лінійний за кількістю файлів вузлів. Більший граф → ділити на кілька `mt/`-коренів/remote — механізм монорепо (вище) це вже підтримує; правило: окремий корінь на команду, продукт або тенанта.
- **Ріст refs обмежений за побудовою:** claims видаляються при publish, run refs — при publish або за `run_ref_ttl_days`, archive/i18n — за TTL-GC (`mt cleanup`).
- **Інкрементальний scan** (кеш за commit/mtime) — оптимізація-напрям; зобовʼязань 0.3.0 не бере, поки лінійний scan не стане вузьким місцем на реальному графі.

## Хостинг relay: self-hosted-first

0.3.0 розраховано на **власний relay** (Docker/k8s — у [stack.md](stack.md)); соло-локальний режим працює взагалі без relay (див. відмовостійкість). Багатотенантний hosted-relay як сервіс — свідомо поза scope архітектури; це продуктове рішення з білінгом та ізоляцією тенантів, окремий документ на пізніше.

## Bootstrap

```bash
# Передумови: branch protection на main; relay розгорнутий (опційно для соло-локального)
mt setup            # .mt.json + .mt/system-prompt.md + mt/ + git hook; fail closed без protection
mt login            # реєстрація пристрою на relay (пропустити для offline-режиму)

mt init my-project --task "..." --mode agent --budget-sec 3600
mt run mt/my-project/        # автономно — або:
mt attach mt/my-project/     # інтерактивно з будь-якої поверхні
```

## Наскрізні сценарії (Definition of Done архітектури)

1. **Автономний headless (класичний MT):** init → watch → plan (composite) → spawn --approve → діти паралельно → аудит із clarification → composite-агрегація → resolved. Без relay, без клієнтів.
2. **Мультихост, один акаунт:** хост A (`mt serve`) веде інтерактивну сесію → користувач на машині B робить «перенести сюди» → handoff: B продовжує ту саму розмову з повною історією; спроба писати без claim → відхилено CAS-ом.
3. **Спільна задача, два акаунти:** A створює задачу → запрошує B (`approver`) → телефон B отримує стрічку і підписує ApprovalResponse → хост A звіряє підпис pubkey-єм пристрою B → виконує деструктивну дію → підпис видно у `run_NNN.md ## Approvals`. Потім роль B → `host` → B робить handoff і веде задачу далі; підписка стороннього акаунта на кімнату → відмова relay.
4. **Dashboard:** `client_kind: "mt-dashboard"` підписується на піддерево → бачить live `NodeState`/`PlanReview`/`Committed` усього графа; апрув плану з телефона → `plan-approved_NNN.md` з підписом.
5. **Деградація:** вимкнути relay посеред сценарію 2 → сесія на активному хості триває; handoff можливий через expiry+grace takeover; після повернення relay presence/push відновлюються.
