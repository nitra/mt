---
type: layered-translation
source: architecture/operations.md
lang: en
sourceFileCrc: d34602c7
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Operation

> Target architecture part **0.3.0-draft** — [content](index.md) · [overview](overview.en.md)

## Essence

This document describes the architectural contract for system operation, defining a clear command-line and configuration interface. It guarantees reliable operation in various modes—from fully autonomous to interactive multi-user sessions. The system is designed for high fault tolerance, ensuring process continuity even when communication services fail. Key decisions include security, isolation, and scaling mechanisms to support complex, long-running tasks.

## CLI Contract

Config: `MT_DIR` env or `.mt.json` → `mt_dir`, default `./mt/`. All commands are `--json`.

```
# graph core (no changes from 0.2.0)
mt setup | init | plan | status | scan | run | kill | invalidate |
   done | audit | failed | spawn | stop | cleanup | watch

# host and sessions (NEW)
mt serve [--relay wss://…]        ← headless agent-server (always-on machine)
mt attach <node> [--remote]       ← interactive session: local host via
                                    port-file or remote via relay; REPL
mt handoff <node>                 ← "transfer here": HandoffRequest + claim

# account and participants (NEW)
mt login                          ← device-flow authorization on relay
mt sessions                       ← active account runs, including shared
                                    (who where, who holds claim, my role)
mt invite <root-node> <email> --role host|approver|viewer
mt members <root-node>
```

`mt watch`/`mt run --auto` are saved as single-shot inputs in the same logic residing in the agent-server (server-less fallback mode). Exit codes for `mt scan`/`mt watch`: `0` — OK, `1` — there are nodes requiring attention.

`mt cleanup [--older-than N]` (default 7 days): orphan worktrees without active claim, dead running markers, remote orphan run refs (older than `run_ref_ttl_days`), stale archive refs (older than `archive_ttl_days`).

## Configuration (`.mt.json`)

In addition to the configuration from 0.2.0 (claim/publish/budget/retry/audit/model/skill\_profiles — no changes) are added:

```json
{"relay_url":"wss://relay.example.com","server_port_file":"~/.nitra/server.port","device_key_path":"~/.nitra/device.key","interactive_claim_lease_sec":900,"interactive_claim_renew_sec":60,"session_archive":true,"archive_ref_prefix":"refs/mt/archive","archive_ttl_days":90,"require_signed_approvals":false,"surface_profiles":{"designer":"local-omlx","writer":"litellm"},"provider_profiles":{"local-omlx":{"base_url":"http://127.0.0.1:8080/v1","model":"…"},"local-ollama":{"base_url":"http://127.0.0.1:11434/v1","model":"…"},"litellm":{"base_url":"http://…/v1","model":"…"}}}
```

**Provider Model:** `model_map` (MIM/AVG/MAX) and `provider_profiles` — one mechanism: the tier resolves to a profile. Autonomous runs choose based on `model_tier` from `a.md`; interactive sessions can override the profile per-turn via `surface`-hint (`surface_profiles`); otherwise, the session profile. LLM transport — unified provider interface (OpenAI-compatible as a minimum common denominator; specifics are in [stack.md](stack.en.md)).

Per-node override: `mt/<node>/.mt-override.json`. `schema_version` is the first field; unknown/absent → fail closed.

Baseline keys from 0.2.0 with specific default values canonically live in the code (`CONFIG_DEFAULTS` in `mt-core`, wrapper `npm/lib/core/config.mjs`; generated reference — `npm/lib/core/docs/config.md`); chapters document the semantics of the keys — map below.

### Key Reference Guide (where described)

| Key Group | Keys | Chapter |
| --- | --- | --- |
| Location | `mt_dir` (`MT_DIR` env) | here |
| Budget/watchdog | `budget_sec`, `budget_hard_sec(_multiplier)`, `budget_total_sec`, `progress_timeout_sec`, `deadline` | [graph.md](graph.en.md) |
| Retry/escalation | `agent_retry_max`, `engineer_retry_max`, `plan_reject_max`, `retry_ladder`, `run_summary_threshold` | [graph.md](graph.en.md) |
| Audit | `audit`, `audit_model`, `audit_retry_max`, `audit_schedule_days`, `audit_on_patch`, `clarification_timeout_sec` | [graph.md](graph.en.md) |
| Claim/lease | `claim_grace_sec`, `claim_renew_sec`, `interactive_claim_lease_sec`, `interactive_claim_renew_sec` | [git.md](git.en.md), [runtime.md](runtime.en.md) |
| Publish/refs | `publish_retry_base_ms`, `publish_retry_max`, `run_ref_ttl_days`, `session_archive`, `archive_ref_prefix`, `archive_ttl_days` | [git.md](git.en.md) |
| Parallelism | `agent_concurrency` | [git.md](git.en.md) |
| Providers/models | `model_map` (MIM/AVG/MAX), `provider_profiles` | here, [stack.md](stack.en.md) |
| Surfaces/tools | `surface_profiles`, `mcp_servers` | [surfaces.md](surfaces.en.md) |
| Security | `skill_profiles` (sandbox), `secrets` (in `a.md`), `require_signed_approvals`, `device_key_path` | here, [access.md](access.en.md) |
| Relay/host | `relay_url`, `server_port_file` | here, [runtime.md](runtime.en.md) |
| i18n | `i18n.{base_lang, eager, publish_langs, include, exclude, model_tier, ttl_days}` | [i18n.md](i18n.en.md) |

## Monorepo: multiple `mt/`

```
monorepo/
  mt/            ← global (cross-workspace tasks)
  packages/api/mt/
  .worktrees/    ← always in git root
```

`MT_DIR` points to a specific `mt/`; one orchestrator per root. `mt/` cannot be in a `.gitignore` directory; scan skips hidden, `node_modules`/`target`/`dist`/`build`.

## Security model

- **Sandbox Profiles:** skill → profile in `skill_profiles`: allowlist of commands, network (off by default), fs-scope (worktree). Command outside the allowlist → deny.
- **Secrets Broker:** `a.md` → `secrets: [KEY]`; wrapper injects via ENV from OS keychain; masks in outputs. Secrets are not in node files.
- **PII:** In git → only handles; mapping handle → account in `.mt/directory.json` (git-ignored) and relay.
- **Device Keys:** Private keys never leave the device keystore; relay stores only pubkeys; device compromise → device removal from relay (signatures cease being accepted immediately due to pubkey-cache with TTL).
- **ACL:** Relay → "who can access whom" (membership, rooms); git-hosting → access to remote; no access lists in node files.
- **Read-scope:** The agent reads files of any nodes in its `mt/` (trade-off); isolation → separate `mt/`/remote per command or tenant.

## Fault Tolerance

| Failure | Behavior |
| --- | --- |
| Relay unavailable | Hosts remain operational: claim/publish/scan via git; wake → cron fallback; remote clients and push temporarily unavailable; local clients work via WS/in-process |
| Host dies mid-session | Claim expires → stalled → takeover by another host; log is recovered from the last pushed run ref (loss ≤ 1 unfinished step) |
| Git remote unavailable | Interactive session continues locally (commits are accumulated), push retries; done/handoff are blocked until recovery |
| Client disconnects | Nothing: session lives on the host; reconnect → replay from `want_replay_from` |

## Scaling Limits (design envelope)

- **Target scale — up to ~5–10k nodes per `mt/` root**: scan is linear with the number of node files. A larger graph → split into multiple `mt/` roots/remotes — the monorepo mechanism (above) already supports this; rule: separate root per team, product, or tenant.
- **Ref growth is limited by structure**: claims are deleted upon publish, run refs → upon publish or after `run_ref_ttl_days`, archive/i18n → after TTL-GC (`mt cleanup`).
- **Incremental scan** (cache by commit/mtime) — a directional optimization; 0.3.0 obligations do not take it unless linear scan becomes a bottleneck on the real graph.

## Relay Hosting: self-hosted-first

0.3.0 is designed for a **self-hosted relay** (Docker/k8s — in [stack.md](stack.en.md)); solo-local mode works without a relay at all (see fault tolerance). Multi-tenant hosted relay as a service → intentionally outside the architecture scope; this is a product solution with billing and tenant isolation, a separate document for later.

## Bootstrap

```bash
# Prerequisites: branch protection on main; relay deployed (optional for solo-local)
mt setup            # .mt.json + .mt/system-prompt.md + mt/ + git hook; fail closed without protection
mt login            # device registration on relay (skip for offline mode)

mt init my-project --task "..." --mode agent --budget-sec 3600
mt run mt/my-project/        # autonomous - or:
mt attach mt/my-project/     # interactive from any surface
```

## End-to-End Scenarios (Definition of Done for Architecture)

1. **Autonomous headless (classic MT):** init → watch → plan (composite) → spawn --approve → children in parallel → audit with clarification → composite aggregation → resolved. Without relay, without clients.
2. **Multi-host, single account:** Host A (`mt serve`) runs an interactive session → user on machine B performs "transfer here" → handoff: B continues the same conversation with full history; attempt to write without a claim → rejected by CAS.
3. **Shared task, two accounts:** A creates a task → invites B (`approver`) → B's phone receives the feed and signs the ApprovalResponse → Host A verifies B's device pubkey signature → executes a destructive action → signature is visible in `run_NNN.md ## Approvals`. Then role B → `host` → B performs a handoff and continues the task; third-party account signing into the room → relay rejection.
4. **Dashboard:** `client_kind: "mt-dashboard"` subscribes to a sub-tree → sees live `NodeState`/`PlanReview`/`Committed` of the entire graph; plan approval from phone → `plan-approved_NNN.md` with signature.
5. **Degradation:** Disable the relay mid-scenario 2 → session continues on the active host; handoff possible via expiry+grace takeover; after relay recovery, presence/push are restored.
