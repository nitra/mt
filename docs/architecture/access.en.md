---
type: layered-translation
source: architecture/access.md
lang: en
sourceFileCrc: 46f2e33d
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# People, devices, access

> Part of the target architecture **0.3.0-draft** — [content](index.md) · [overview](overview.en.md)

## Essence

This document outlines the architecture of interaction between users, devices, and key system components. It defines clear roles for participants—from owner to viewer—and details the mechanism of Approvals for destructive actions. The core guarantee of the system is the cryptographic audit of every step, where the Relay's role is only coordination and routing, without storing critical data. This ensures a high level of trust and transparency, where true control remains in the hands of the participants.

## Accounts, Devices, Keys

- The user logs into the relay (email + passkey); the relay knows all the account's devices and their presence. Zero-knowledge is not required.
- Each device has an **Ed25519 keypair**; the private key is stored in a platform-dependent keystore. The device registers with the relay: `{name, role: host|client, pubkey}` → `device_token`.
- **Signed approvals** are a cryptographic audit trail of destructive actions, including a multi-party scenario (approval from another participant's device).

## Relay: Duties and Limits

Coordinator. Persistent: only accounts/membership/invitations; the rest is ephemeral.

| Does | Does NOT |
| --- | --- |
| auth accounts/devices | does not store session logs |
| membership of tasks + invitations | does not proxy git |
| presence (hosts: hostname, projects, active nodes) | **does not issue lease** (the truth is in git claim) |
| forwarding Envelope across room-nodes | does not parse payload further than routing fields |
| broadcasting ClaimChanged, HandoffRequest | does not execute agents |
| buffering the last ~200 Envelope on run (live-tail) | |
| pushing "new events" / "invitations" / "needs attention" | |
| distributing participants' pubkeys (for signature verification) | |

Rate limit on connections; frame limit. Data scheme:

```sql
accounts(account_id, email, display_name, …)
devices(account_id, device_id, role, pubkey, last_seen)
tasks(root_node_hash, owner_account, project_name, remote_url, created_at)
task_members(root_node_hash, account_id, role, invited_by, joined_at)
  -- role: owner | host | approver | viewer; owner is created automatically
invitations(invitation_id, root_node_hash, from_account, to_email, role, status, created_at)
  -- status: pending | accepted | declined | revoked
```

**Membership is tied to the root task node** (`mt init`-root) and is inherited by the entire subtree. The relay room = node; subscription is allowed only to devices of participant accounts of the root.

## Roles and Mapping to MT Actors

| Relay Role | git Access | Graph Rights |
| --- | --- | --- |
| **owner** | yes (precondition) | all + invitation, role change, transfer ownership |
| **host** | yes (precondition) | maintain claim (runner/session), `mt run/done/audit/spawn`, handoff |
| **approver** | **not required** | sign ApprovalResponse: mid-run tool approvals, plan-review, audit verdicts |
| **viewer** | **not required** | only event stream (relay rejects viewer client events, including CancelTurn) |

- Relay Role ↔ MT: `actor: human` in `h.md` — this is a participant with any role, whose handle = `assignee`; `actor: engineer/auditor` — agent roles of the host; a human auditor requires `approver+`.
- **Git Access Precondition:** For a participant with the host role to raise a task on their machine, their git credentials must have access to the remote — this is the responsibility of the git hosting (GitHub/GitLab/Gitea); the relay does not proxy git. Approver and viewer do not require git access — they only need the event stream.

**Relay Membership API:** `invite {email, role}` (owner; push to recipient or pending registration) → `accept/decline` (accept → entry in `task_members` + broadcast `MemberChanged`) → `PATCH role` / `DELETE` (owner) → `transfer ownership`. `GET pubkeys` — pubkeys of participant devices (`approver+`); accessible only to participant devices.

## Approvals: Three Gates, One Mechanism

| Gate | Trigger | Materialization in git |
| --- | --- | --- |
| **Mid-run tool approval** | destructive ToolCall (edit outside worktree policy, merge, deploy…) → `ApprovalRequest` | line in `## Approvals` of the corresponding `run_NNN.md` |
| **Plan-review** | composite `plan_NNN.md` → `PlanReview` event | `plan-approved/rejected_NNN.md` with `approved_by` block |
| **Human audit verdict** | `pending-audit` + human auditor → `AuditPending` | `audit-result_NNN.md` with signature block |

The flow is the same: the host sends a request to the room → any participant device with the `approver+` role signs `(request_id, approved, node_hash, run_token)` with its own key → the host verifies the signature against the pubkey cache (request to relay, cache with TTL; signature outside the list → rejection + `Error`) → materializes into the node file → fenced publish. Key scenario: participant B's phone approves a destructive action of account A, without having any git access.

Waiting for approval = `WaitingApproval` state of the run; timeout → task is canceled (per-node policy).

## Trust Matrix

Who sees what and what it relies on (0.3.0; E2E encryption of Envelope is **not** included — honest boundary):

| Party | Sees | Trusts | DOES NOT Trust / Checks Itself |
| --- | --- | --- | --- |
| **git hosting** | the entire canonical state: `main`, claims, runs, archive, i18n | — | Access Control List — its responsibility (host role precondition) |
| **relay** | accounts, membership, presence, routing metadata; **technically** — Envelope bytes (TLS termination), but the behavioral boundary: does not parse, does not store | delegates nothing to git hosting | does not issue lease, does not decide "who writes" — the truth is in git claim |
| **agent-server (host)** | everything within its tasks: worktree, logs, secrets from the local keychain | git hosting (ACL), its own keystore | **verifies approval signatures itself** against the pubkey cache — relay is only transport; expired cache → rejection |
| **client (device)** | event stream of its rooms (filtered by capabilities and role) | host — regarding the content of events and the graph state | the private key never leaves the keystore; signs only what is locally displayed (request_id + diff) |

Consequence for sensitive commands: if the content of conversations cannot be shown even to the relay operator — deploy your own relay ([operations.md](operations.en.md), self-hosted-first). E2E over rooms — a possible future extension, not 0.3.0.

## Lifecycle of Keys and Accounts

- **Rotation:** the device generates a new keypair and registers it with the relay; the old one is marked `retired` with a fixed validity period — the relay keeps the history of the device's pubkeys. Historical signatures in git remain a valid fact: they were verified by the host at the time of acceptance, and this is materialized in the node files.
- **Revocation:** device deletion (compromise) is described above — new signatures are immediately rejected thanks to the pubkey cache with TTL; materialized historical signatures are not invalidated.
- **Account Recovery:** a lost passkey is recovered via the email-flow relay (in the reference stack, this is a standard Ory Kratos function); new devices after recovery are registered again — old keys are not transferred.
- **Owner Succession:** recommended practice for important tasks — a second participant with the owner role (transfer ownership exists natively). For a disappeared single owner — an administrative procedure of the relay operator with the explicit consent of all participants with the host role. Crowdsourced cryptographic protocols are deliberately not introduced in 0.3.0.

## Push Notifications

The relay sends data messages to mobile/desktop devices of three types:

1. "new events in task X" (wake up client/host);
2. "you have been invited to task X";
3. "task X requires attention" — `unresolvable`, `plan-review`, `pending` for the `h.md`-assignee (`notify: true`), `AuditPending`.

Type 3 closes the gap in basic MT, where notify was a placeholder.
