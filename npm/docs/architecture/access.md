---
type: architecture
description: 'Акаунти і ключі пристроїв, relay та membership, ролі, три approval-гейти з Ed25519-підписами, push'
tags: [access, relay, membership, approvals, security]
timestamp: 2026-07-07
---

# Люди, пристрої, доступ

> Частина цільової архітектури **0.3.0-draft** — [зміст](index.md) · [огляд](overview.md)

## Акаунти, пристрої, ключі

- Користувач логіниться на relay (email + passkey); relay знає всі пристрої акаунта та їх presence. Zero-knowledge не вимагається.
- Кожен пристрій має **Ed25519 keypair**; приватний ключ — у платформозалежному keystore. Пристрій реєструється на relay: `{name, role: host|client, pubkey}` → `device_token`.
- **Підписані approvals** — криптографічний audit trail деструктивних дій, включно з мультипартійним сценарієм (апрув від пристрою іншого учасника).

## Relay: обов'язки і межі

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

## Ролі і мапінг на MT-акторів

| Роль relay | git-доступ | Права у графі |
| --- | --- | --- |
| **owner** | так (precondition) | усе + запрошення, зміна ролей, transfer ownership |
| **host** | так (precondition) | тримати claim (runner/сесія), `mt run/done/audit/spawn`, handoff |
| **approver** | **не потрібен** | підписувати ApprovalResponse: mid-run tool approvals, plan-review, аудит-вердикти |
| **viewer** | **не потрібен** | лише стрічка подій (relay відхиляє клієнтські події viewer-а, включно з CancelTurn) |

- Relay-роль ↔ MT: `actor: human` у `h.md` — це учасник із будь-якою роллю, чий handle = `assignee`; `actor: engineer/auditor` — агентні ролі хоста; людина-аудитор потребує `approver+`.
- **Precondition git-доступу:** щоб учасник із роллю host підняв задачу на своїй машині, його git-креденшели мають мати доступ до remote — це відповідальність git-хостингу (GitHub/GitLab/Gitea); relay git не проксіює. Approver і viewer git-доступу не потребують — їм досить стрічки подій.

**Membership API relay:** `invite {email, role}` (owner; push отримувачу або pending до реєстрації) → `accept/decline` (accept → запис у task_members + broadcast MemberChanged) → `PATCH role` / `DELETE` (owner) → `transfer ownership`. `GET pubkeys` — pubkey-и пристроїв учасників `approver+`; доступ лише пристроям учасників.

## Approvals: три гейти, один механізм

| Гейт | Тригер | Матеріалізація у git |
| --- | --- | --- |
| **Mid-run tool approval** | деструктивний ToolCall (edit поза worktree-політикою, merge, деплой…) → `ApprovalRequest` | рядок у `## Approvals` відповідного `run_NNN.md` |
| **Plan-review** | composite `plan_NNN.md` → подія `PlanReview` | `plan-approved/rejected_NNN.md` з блоком `approved_by` |
| **Аудит-вердикт людини** | `pending-audit` + аудитор-людина → `AuditPending` | `audit-result_NNN.md` з блоком підпису |

Потік однаковий: хост шле запит у кімнату → будь-який пристрій учасника з роллю `approver+` підписує `(request_id, approved, node_hash, run_token)` власним ключем → хост звіряє підпис із pubkey-кешем (запит до relay, кеш із TTL; підпис поза списком → відмова + `Error`) → матеріалізує у файл вузла → fenced publish. Ключовий сценарій: телефон учасника B апрувить деструктивну дію задачі акаунта A, не маючи жодного git-доступу.

Очікування approval = стан `WaitingApproval` run-а; timeout → хід скасовується (політика per-node).

## Push-нотифікації

Relay шле мобільним/десктопним пристроям data-повідомлення трьох типів:

1. «нові події у задачі X» (розбудити клієнт/хост);
2. «вас запрошено у задачу X»;
3. «задача X потребує уваги» — `unresolvable`, `plan-review`, `pending` для `h.md`-assignee (`notify: true`), `AuditPending`.

Тип 3 закриває дірку базового MT, де notify був заглушкою.
