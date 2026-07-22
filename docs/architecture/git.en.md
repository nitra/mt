---
type: layered-translation
source: architecture/git.md
lang: en
sourceFileCrc: 9c75bbe1
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Coordination via git

> A part of the target architecture **0.3.0-draft** — [content](index.md) · [overview](overview.en.md)

## Essence

This document describes the coordination mechanisms between autonomous AI agents, ensuring the atomicity and integrity of tasks. The main guarantee is the concept of an "authoritative claim," which ensures a single controller for executing work in a node. The system supports state tracking via "run refs" and guarantees reliable work transfer between different hosts through a controlled "checkpoint-handoff" mechanism. All result publications are done through a secure, atomic "fenced publish" process to the `main` branch.

## Claim — Authoritative "Single Quill"

**Authoritative execution claim** — git custom ref: `refs/mt/claims/<node-hash>`, where `node-hash` = the first 20 hex SHA-256 from `<tasks-root>\0<node-path>`. The Claim commit contains `.mt-claim.yml`:

```yaml
schema_version: 1
node: research/analyze
node_hash: <sha>
actor: agent
runner_id: server-1/4821
claimed_at: 2026-06-09T10:00:00Z
lease_until: 2026-06-09T11:00:00Z
token: 1d9c87d2-4f41-4e74-91c2-2d873a62bf04   # = session_id of the interactive session
generation: 1
base_sha: a1b2c3
interactive: false     # NEW: true -> interactive session; affects lease parameters
```

Operations — only exact-SHA CAS:

| Operation | Condition | Effect |
| --- | --- | --- |
| **create** | ref absent | new token, generation 1 |
| **renewal** | Active/Grace, same runner | keeps token/generation, updates `lease_until` |
| **takeover** | Stalled | new token, generation+1 |
| **handoff** (NEW) | Active, cooperative | holder: push run ref + CAS-delete; new host: create (new token, generation+1) |

**Grace period:**

| Phase | Condition | Allowed |
| --- | --- | --- |
| Active | `now() ≤ lease_until` | renewal, publish, handoff |
| Grace | `lease_until < now() ≤ lease_until + claim_grace_sec` | renewal by the original runner |
| Stalled | `now() > lease_until + claim_grace_sec` | takeover |

Interactive sessions use shorter `interactive_claim_lease_sec`/`interactive_claim_renew_sec` (human at the device — quick heartbeat, quick takeover upon host disappearance).

**Claim restricts hosts, NOT clients:** any number of clients from any devices and participant accounts can be connected to the session simultaneously; only the claim holder can write to the node.

**Single publish owner:** only the claim holder publishes the result to `main`. Mutual exclusion of execution is not guaranteed — for non-idempotent side effects, `generation` serves as a fencing token.

## Run ref and Session Log

Run ref: `refs/mt/runs/<node-hash>/<token>` — a branch of the working state of the current attempt.

- **Autonomous run:** the wrapper updates the run ref at its discretion (minimum — upon completion); the run ref is needed for debug and fenced publish.
- **Interactive run (CHANGED):** **every turn** = a commit in the worktree (file edits + append to `.nitra/session.jsonl`) + **immediate push of the run ref**. This is the mechanism for migration between devices, recovery after host death, and handover to another user. `session.jsonl` — conversation event log (Envelopes — see [runtime.md](runtime.en.md)); `.nitra/state.json` — metadata (cursor, provider profile). Neither `.nitra/` nor screenshots **ever** end up in `main`.

**Session Archive:** upon run ref publish, it is deleted (as in base MT), but if `session_archive: true` — the log is stored in `refs/mt/archive/<node-hash>/<NNN>` (GC by `archive_ttl_days`), and `run_NNN.md` receives the field `session_archive:`.

**Checkpoint-handoff (Privacy Transfer).** A standard handoff transfers the run ref along with the full `session.jsonl` — all draft replies. For transfer to third parties, there is the "from checkpoint" mode: the holder writes `run_NNN (result: handoff)` and a **fresh run ref** containing only the worktree state + distilled summary of the last turns, without the conversation log; the full `session.jsonl` goes to the archive ref, visible only to the author. The receiver continues from a clean context (run N+1). The choice of mode is the parameter `mt handoff --checkpoint` / per-node policy.

## Wrapper: Agent Launch

**Wrapper** (`mt run`; in the target picture — the role of Runner inside agent-server): checks resolved deps + absence of pending-audit → CAS claim → detached worktree from `base_sha` → run ref → launches the agent → watchdog → writes `run_NNN.md` → publish.

**ENV-contract wrapper → agent:** `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, `MT_RUN_NNN`, `MT_ATTEMPT`, `MT_CLAIM_TOKEN`, `MT_CLAIM_GENERATION`. `MT_CLAIM_GENERATION` — fencing token for non-idempotent side effects: single publish owner guarantees only one record of the result in `main`, not mutual exclusion of execution.

## Fenced publish

Result publication (agent, auditor, lifecycle operations) — one atomic push:

```bash
git fetch origin main
git -C <worktree> rebase origin/main
# Check exact claim SHA/token
git push --atomic \
  --force-with-lease=refs/heads/main:<expected-main-sha> \
  --force-with-lease=refs/mt/claims/<node-hash>:<claim-sha> \
  --force-with-lease=refs/mt/runs/<node-hash>/<token>:<run-sha> \
  origin \
  <result-sha>:refs/heads/main \
  :refs/mt/claims/<node-hash> \
  :refs/mt/runs/<node-hash>/<token>
```

Push rejected → retry with exponential backoff (`publish_retry_base_ms` × 2, limit `publish_retry_max`); exhausted → `result: merge-conflict`. Failure family: `run_NNN.md` is published via a separate fenced push; run ref/worktree remain for debug; claim is released via CAS-delete.

**Protected `main`:** runner without bypass → integration branch + PR (approval-only) → integration bot executes the same fenced push. There is no second path to write to `main`; `mt setup` checks branch protection — fail closed. **Batching:** several ready results → one atomic push.

## Parallel Execution

Independent nodes are parallel, each in its own git worktree (path is unique via token). **Remote publish = boundary of atomicity:** the successor starts only after the predecessor is resolved. Merge conflict = standard `failed` → EngineerAgent. `agent_concurrency` limits active agent claims (human ones are not counted).
