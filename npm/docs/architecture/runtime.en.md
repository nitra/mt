---
type: layered-translation
source: architecture/runtime.md
lang: en
sourceFileCrc: 4551fb36
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Runtime: hosts, sessions, surfaces

> Target architecture part **0.3.0-draft** — [content](index.md) · [overview](overview.en.md)

## Essence

This document outlines the target architecture of the system, where logic execution is performed by a centralized, long-lived `agent-server`. The server is responsible for orchestration, execution, and management of interactive sessions, ensuring a unified view of the state for all clients. System interaction occurs through a strict event protocol (`Envelope`), which allows clients to interact with the agent core via defined interfaces. The architecture supports various operating modes—from autonomous launch to deep interactive control—as well as session migration mechanisms between hosts to ensure continuity.

## agent-server — one host-process per machine

All execution logic resides in the long-lived `agent-server` process. ALL surfaces are thin clients of the same event protocol; no client calls the agent core directly.

**Discovery / single-instance:** upon startup, the server writes a port-file (`~/.nitra/server.port`: port + pid + token-hash) and holds a lock-file. The application, before starting its own server, reads the port-file and tries `ClientHello`; if live → connects as a client; if stale lock → overwrites and starts its own. No matter how many applications are started, there is only one `agent-server`.

The `agent-server` combines three roles (former separate MT processes):

| Role | Responsibilities |
| --- | --- |
| **Orchestrator** (former `mt watch`) | graph scanning, ready-nodes, dispatching runners/audits, composite aggregation, cleanup |
| **Runner** (former `mt run` wrapper) | claim → worktree → agent → publish → release; budgets, watchdog, telemetry |
| **Session host** (NEW) | interactive sessions: broadcasting Envelope to clients, replay, approvals, preview |

**Client Transports:** (a) local WS `ws://127.0.0.1:{port}` with a one-time token; (b) in-process channel (embedding in the desktop application); (c) relay-client — outgoing wss:// to the relay for remote clients. Reconnect with backoff.

### External Node Executor (`node_executor`)

The Runner executes the agent-node via one of two paths:

- **Embedded Claude-agent path** (default) — spawns `claude` with the model specified by `model_tier` (`.mt.json` `model_map`);
- **External Executor** — if `.mt.json` has `node_executor` (command string, e.g., `npx n-cursor mt-run-node`), the runner spawns this command instead of Claude. Motivation: the external consumer executes nodes with its **own** harness (its own models/tiers, its own telemetry), not with `model_map` Claude models — the tier-canon remains mandatory even for fix-nodes.

MT retains **all orchestration**: claim/lease, worktree isolation, budget/timeout (hard-timeout = `budget_hard_sec`), `## Check`, fenced publish. The Executor is for **"apply changes in worktree"** only; the contract artifact `fact_NNN.md` synthesizes the runner (the executor does not write it).

**Node Executor Contract:**

| Channel | Content |
| --- | --- |
| argv | `<node_executor...> <node-dir>` — absolute path to the node directory in the worktree (= cwd) |
| env | `MT_NODE_DIR`, `MT_WORKTREE`, `MT_RUN_TOKEN`, `MT_MODEL_TIER` (MIM/AVG/MAX — consumer maps to its pool), `MT_TASK_PATH`, `MT_RUN_NNN`, `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT` |
| stdout | last non-empty line = JSON `{ applied: bool, touchedFiles: string[] }` (best-effort; non-JSON → applied=false) |
| exit | `0` → runner runs `## Check` (if present) and synthesizes `fact_NNN.md` upon success → standard merge/publish; non-zero → failed-run standard (worktree remains for diagnostics) |

This applies only to the `agent` actor; `human` and other actors — unchanged. **Backward compatibility:** If `node_executor` is missing → current Claude path remains unchanged. Granularity is global (per repo/`.mt.json`): the consumer that owns the entire `mt/` graph executes ALL agent-nodes with its harness; this makes "silent" rollback of an individual node to the Claude path impossible (deliberately avoided intermediate state).

## Wake: push instead of polling

The basic MT woke up via cron every 5 mins. In the target architecture:

1. **Relay push "new events in task X"** → `agent-server` immediately rescans the relevant node;
2. `post-merge` git hook → `mt run --auto` + `touch .mt/wake` (local merges);
3. **Cron/periodic rescan — fallback** (relay unavailable → system works as basic MT).

`mt watch` logic (dispatch, unresolvable alerts, GC) executes on every wake. Queue sorting for `waiting`: leaf nodes → `deadline` → `created_at`.

## Event Protocol

The contract between client ↔ host. `PROTOCOL_VERSION = 4` (v1/v2 — scaffold-spec history; v3 — intermediate draft without `lang`; incompatible versions → explicit error with upgrade hint).

### Envelope

```
Envelope {
  seq: u64                    // monotonic within a run; assigns claim holder
  ts: DateTime<Utc>
  node_hash: string           // node room/address
  run_token: uuid             // = claim token; session identifier
  device_id: uuid?            // who initiated (for client events)
  account_id: uuid?           // in shared tasks, multiple participants
  event: Event
}
```

`session.jsonl` is an append-only list of Envelopes (except for ephemeral ones: `PreviewScreenshot`, `AgentTextDelta` can be omitted → `AgentTextDone` aggregate is logged).

### Events

```
// client → host
UserMessage      { text, attachments[], surface?: string }
                 // surface-hint: "designer" | "writer" | "cli" | … —
                 // agent can suggest the corresponding provider/prompt profile
ContextSelected  { kind: string, payload: json, bounding_box?: Rect }
                 // "dom_element" | "text_range" | "file_region" | … —
                 // context "clicked" by the user, independent of the application
ApprovalResponse { request_id, approved, signature: bytes }
                 // Ed25519 signature from the device over (request_id, approved, node_hash, run_token);
                 // the device can belong to ANOTHER account with approver+ role
CancelTurn       {}
DoneSession      {}   // finish run: host executes mt done-semantics —
                      // fenced publish fact in main (v4-minor)
ReleaseSession   {}   // pause/release: CAS-delete claim; log remains
                      // in run ref base for recovery (v4-minor)

// host → clients
AgentTextDelta   { text }
AgentTextDone    {}
ToolCall         { call_id, name, args }
ToolResult       { call_id, ok, summary }
ApprovalRequest  { request_id, action, diff? }
PreviewScreenshot{ ref_id, mime }     // EPHEMERAL: only relay/WS, never in git;
                                      // only to clients with capability "preview"
FileChanged      { path }
Committed        { commit_hash, message }
NodeState        { path, state, claim?: {holder_device, lease_until, generation} }
                 // derived node state — for session and for mt-dashboard
ClaimChanged     { node_hash, holder_device_id?, lease_until?, generation }
                 // broadcasted by relay; source of truth — git ref
MemberChanged    { account_id, role? }   // None = removed
PlanReview       { plan_ref }            // composite plan awaits approval
AuditPending     { fact_ref }            // fact awaits human auditor verdict
Error            { message }
```

### Handshake

```
ClientHello {
  protocol_version, device_id, device_token,
  client_kind: "designer" | "writer" | "cli" | "mobile" | "mt-dashboard" | …,
  client_capabilities: ["preview", "approvals", "diff_view", "self-translate", …],
  lang: string,                       // MANDATORY (v4): BCP-47 participant language
  want_replay_from: Option<seq>,
}
→ ServerHello { protocol_version, session_list }
```

The server **filters events by capabilities** (PreviewScreenshot → only "preview"). `lang` controls live translation: a client without the `self-translate` capability receives text events already translated into its language; with `self-translate` → original (translates itself). Details — [i18n.md](i18n.en.md). Replay: live tail from memory (buffer), deeper → from `session.jsonl` run ref.

### Error Branches and Backpressure

- **Reconnect:** the client stores the last processed `seq` and reconnects using `want_replay_from`; `seq` is monotonic → no breaks in logged events. Depth beyond buffer → host reads from `session.jsonl` run ref.
- **Backpressure:** for a slow client, the host **discards only ephemeral** events (`AgentTextDelta`, `PreviewScreenshot`) — logged events are always delivered; sending queue overflow → forced disconnect with `Error`; client returns via replay. Frame limit — 2 MB (shared with relay).
- **`PreviewScreenshot` bytes:** the event carries only `ref_id`; the client fetches bytes via a separate request to the host (local HTTP preview module or binary WS frame by `ref_id`) — large binaries do not pass through the event stream and relay buffer.
- **Unknown `Event` variant** within a compatible major version: the client **ignores** (forward-compatibility of minor extensions); incompatible `protocol_version` → failure at handshake.

### `mt-dashboard`

Specialized `client_kind`: subscribes not to one run, but to a **subtree of nodes** (rooms by `node_hash`); receives `NodeState`/`ClaimChanged`/`PlanReview`/`AuditPending`/`Committed` without chat stream. This is a response to "view the entire graph as one picture": aggregation on the client, not a specific session type.

## Interactive Session = Node Run

Life cycle:

```
mt attach <node>  (or UI "open task")
  → host: CAS claim (interactive: true) → worktree from base_sha
  → clients connect (local/via relay), receive replay
  → each turn: UserMessage → agent → ToolCall/ApprovalRequest/…
      → commit (files + session.jsonl) → push run ref
  → completion:
      mt done  → ## Check → fenced publish fact in main (+ archive ref)
      pause    → renewal stops → claim expires → node waiting/stalled
      handoff  → migration to another host (below)
```

Interactive mode affects policies: `progress_timeout_sec` does not apply (human is thinking), budgets are soft-alerts rather than kills; `run_NNN.md` is written the same way (telemetry wall_sec/tokens/cost — from turns).

**Node in two modes:** the same task can start as autonomous (classic MT) and be "picked up" in chat (human opens a failed node interactively — this is a new run with the same contract), and vice-versa: an interactively started task can be left for autonomous retry.

## Session Migration Between Hosts ("move here")

```
1. New host (role host+, git access): sends via relay HandoffRequest{node_hash}
2. Claim holder: finishes the current turn → commit + push run ref
   → writes run_NNN.md (result: handoff) → CAS-delete claim → ack
3. New host: CAS-create claim (new token, generation+1)
   → fetches old run ref → worktree checkout from its tip
   → replays session.jsonl → continues conversation (run N+1, log inherited)
4. Relay unavailable / holder dead → MT path: wait for lease expiry + grace
   → takeover; log is recovered from the last pushed run ref
   (most unfinished turn is lost)
```

Clients do not manually reconnect in this process: the relay broadcasts `ClaimChanged`, clients continue in the same room with a new active host.

## Preview — capability-based module

Preview is an optional module for the interactive run, enabled by project type:

- `PreviewBackend { start(worktree) → PreviewHandle }`; reference → `HtmlPreview`: static HTTP server over worktree + inject picker-script + WebSocket live reload (watcher) + endpoint that broadcasts element selection as `ContextSelected { kind: "dom_element" }`;
- `PreviewScreenshot` is shared only with clients having the "preview" capability; it is never persisted;
- Other surfaces send their `ContextSelected` (text_range, file_region) directly via transport.
