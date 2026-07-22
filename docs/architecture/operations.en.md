---
type: layered-translation
source: architecture/operations.md
lang: en
sourceFileCrc: df7b6592
authored: false
translated: 2026-07-22
model: openai-codex/gpt-5.5
---

# Operations

> Part of target architecture **0.3.0-draft** — [contents](index.md) · [overview](overview.en.md)

## Essence

This document describes the architectural contract for system operations, defining a clear command-line and configuration interface. It ensures reliable operation in different modes — from fully autonomous to interactive multi-user sessions. The system is designed for high fault tolerance, ensuring process continuity even when communication services fail. Key decisions include security, isolation, and scaling mechanisms to support complex, long-running tasks.

## CLI contract

Config: `MT_DIR` env or `.mt.json` → `mt_dir`, default `./mt/`. All commands are `--json`.

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

`mt watch`/`mt run --auto` are retained as one-shot entry points into the same logic that lives in the agent-server (fallback mode without a server). Exit codes for `mt scan`/`mt watch`: `0` — ok, `1` — there are nodes that need attention.

`mt cleanup [--older-than N]` (default 7 days): orphan worktrees without an active claim, dead running markers, remote orphan run refs (older than `run_ref_ttl_days`), expired archive refs (older than `archive_ttl_days`), resolved template instances beyond `keep` ([recurrence.md](recurrence.md)).

## Configuration (`.mt.json`)

Added to the 0.2.0 configuration (claim/publish/budget/retry/audit/model/skill_profiles — unchanged):

```json
{"relay_url":"wss://relay.example.com","server_port_file":"~/.nitra/server.port","device_key_path":"~/.nitra/device.key","interactive_claim_lease_sec":900,"interactive_claim_renew_sec":60,"session_archive":true,"archive_ref_prefix":"refs/mt/archive","archive_ttl_days":90,"require_signed_approvals":false,"surface_profiles":{"designer":"pi","writer":"codex"}}
```

Configuration of **executors** (providers/models) is not here: it is user-level, shared across all repositories, and lives in ENV (`MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`, `MT_AGENT_CLI_MODEL_MAP` — [runtime.md](runtime.en.md#підписочні-cli-виконавці-agent_cli)). `.mt.json` is strictly repo-scoped.

**Executor model:** the MIN/AVG/MAX tier canon is resolved to a concrete model of the selected CLI via env `MT_AGENT_CLI_MODEL_MAP` ([runtime.md](runtime.en.md#підписочні-cli-виконавці-agent_cli)). Autonomous runs choose by `model_tier` from `a.md`; interactive ones may override CLI per-turn via the `surface` hint (`surface_profiles`). The transport for AI calls is exclusively **ACP** (details in [stack.md](stack.en.md)).

Per-node override: `mt/<node>/.mt-override.json`. `schema_version` is the first field; unknown/missing → fail closed.

Baseline 0.2.0 keys with concrete default values canonically live in code (`CONFIG_DEFAULTS` in `mt-core`, wrapper `npm/lib/core/config.mjs`; generated reference — `npm/lib/core/docs/config.md`); chapters document key semantics — the map below.

### Key reference (where each item is described)

| Key group | Keys | Chapter |
| --- | --- | --- |
| Location | `mt_dir` (`MT_DIR` env) | here |
| Budgets/watchdog | `budget_sec`, `budget_hard_sec(_multiplier)`, `budget_total_sec`, `progress_timeout_sec`, `deadline` | [graph.md](graph.en.md) |
| Retry/escalation | `agent_retry_max`, `engineer_retry_max`, `plan_reject_max`, `retry_ladder`, `run_summary_threshold` | [graph.md](graph.en.md) |
| Audit | `audit`, `audit_model`, `audit_retry_max`, `audit_schedule_days`, `audit_on_patch`, `clarification_timeout_sec` | [graph.md](graph.en.md) |
| Claim/lease | `claim_grace_sec`, `claim_renew_sec`, `interactive_claim_lease_sec`, `interactive_claim_renew_sec` | [git.md](git.en.md), [runtime.md](runtime.en.md) |
| Publish/refs | `publish_retry_base_ms`, `publish_retry_max`, `run_ref_ttl_days`, `session_archive`, `archive_ref_prefix`, `archive_ttl_days` | [git.md](git.en.md) |
| Parallelism | `agent_concurrency` | [git.md](git.en.md) |
| Executors/models | ENV: `MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`, `MT_AGENT_CLI_MODEL_MAP` | [runtime.md](runtime.en.md), [stack.md](stack.en.md) |
| Surfaces/tools | `surface_profiles`, `mcp_servers` | [surfaces.md](surfaces.en.md) |
| Recurrence | `templates_dir`; per-template `recurrence.md` (`schedule`/`every`, `tz`, `overlap`, `catchup`, `keep`) | [recurrence.md](recurrence.md) |
| Security | `skill_profiles` (sandbox), `secrets` (in `a.md`), `require_signed_approvals`, `device_key_path` | here, [access.md](access.en.md) |
| Relay/host | `relay_url`, `server_port_file` | here, [runtime.md](runtime.en.md) |
| i18n | `i18n.{base_lang, eager, publish_langs, include, exclude, model_tier, ttl_days}` | [i18n.md](i18n.en.md) |

## Monorepo: multiple `mt/`

```
monorepo/
  mt/            ← глобальний (cross-workspace задачі)
  packages/api/mt/
  .worktrees/    ← завжди в git root
```

`MT_DIR` points to a specific `mt/`; one orchestrator per one root. `mt/` cannot be in a `.gitignore`d directory; scan skips hidden directories, `node_modules`/`target`/`dist`/`build`.

## Security model

- **Sandbox profiles:** skill → profile in `skill_profiles`: command allowlist, network (off by default), fs-scope (worktree). Command outside allowlist → rejection.
- **Secrets broker:** `a.md` → `secrets: [KEY]`; wrapper injects via ENV from the OS keychain; masks in outputs. There are no secrets in node files.
- **PII:** in git — only handles; handle → account mapping is in `.mt/directory.json` (git-ignored) and relay.
- **Device keys:** private keys never leave the device keystore; relay stores only pubkeys; device compromise → removing the device from relay (signatures stop being accepted immediately thanks to the pubkey cache with TTL).
- **ACL:** relay defines “who can do what with whom” (membership, rooms); git hosting defines access to remote; no access lists in node files.
- **Read-scope:** an agent reads files of any nodes within its `mt/` (trade-off); isolation is a separate `mt/`/remote per team or tenant.

## Fault tolerance

| Failure | Behavior |
| --- | --- |
| Relay unavailable | hosts keep working: claim/publish/scan via git; wake — cron fallback; remote clients and push are temporarily unavailable; local clients work via WS/in-process |
| Host died mid-session | claim expires → stalled → takeover by another host; journal is restored from the last pushed run ref (loss ≤ 1 unfinished turn) |
| Git remote unavailable | interactive session continues locally (commits accumulate), push retries; done/handoff are blocked until recovery |
| Client disconnected | nothing: session lives on the host; reconnect → replay from `want_replay_from` |

## Scale boundaries (design envelope)

- **Target scale — up to ~5–10k nodes per one `mt/` root**: scan is linear in the number of node files. A larger graph → split into several `mt/` roots/remotes — the monorepo mechanism (above) already supports this; rule: separate root per team, product, or tenant.
- **Refs growth is bounded by construction:** claims are removed on publish, run refs — on publish or by `run_ref_ttl_days`, archive/i18n — by TTL-GC (`mt cleanup`).
- **Incremental scan** (cache by commit/mtime) is an optimization direction; 0.3.0 makes no commitments until linear scan becomes a bottleneck on a real graph.

## Relay hosting: self-hosted-first

0.3.0 is designed for a **self-hosted relay** (Docker/k8s — in [stack.md](stack.en.md)); solo-local mode works without any relay at all (see fault tolerance). A multi-tenant hosted relay as a service is deliberately out of scope for the architecture; it is a product decision with billing and tenant isolation, a separate document for later.

## Bootstrap

```bash
# Передумови: branch protection на main; relay розгорнутий (опційно для соло-локального)
mt setup            # .mt.json + .mt/system-prompt.md + mt/ + git hook; fail closed без protection
mt login            # реєстрація пристрою на relay (пропустити для offline-режиму)

mt init my-project --task "..." --mode agent --budget-sec 3600
mt run mt/my-project/        # автономно — або:
mt attach mt/my-project/     # інтерактивно з будь-якої поверхні
```

## End-to-end scenarios (architecture Definition of Done)

1. **Autonomous headless (classic MT):** init → watch → plan (composite) → spawn --approve → children in parallel → audit with clarification → composite aggregation → resolved. No relay, no clients.
2. **Multi-host, one account:** host A (`mt serve`) runs an interactive session → user on machine B does “move here” → handoff: B continues the same conversation with full history; attempt to write without claim → rejected by CAS.
3. **Shared task, two accounts:** A creates a task → invites B (`approver`) → B’s phone receives the feed and signs ApprovalResponse → host A verifies the signature with device B’s pubkey → performs the destructive action → signature is visible in `run_NNN.md ## Approvals`. Then B’s role → `host` → B does handoff and continues leading the task; subscription of an external account to the room → rejected by relay.
4. **Dashboard:** `client_kind: "mt-dashboard"` subscribes to a subtree → sees live `NodeState`/`PlanReview`/`Committed` for the whole graph; plan approval from phone → `plan-approved_NNN.md` with signature.
5. **Degradation:** turn off relay in the middle of scenario 2 → session on the active host continues; handoff is possible through expiry+grace takeover; after relay returns, presence/push recover.
