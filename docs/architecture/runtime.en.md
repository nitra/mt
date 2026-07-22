---
type: layered-translation
source: architecture/runtime.md
lang: en
sourceFileCrc: 55bd153b
authored: false
translated: 2026-07-22
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Runtime: hosts, sessions, surfaces

> Part of the target architecture **0.3.0-draft** — [content](index.md) · [overview](overview.en.md)

## Essence

This document outlines the target architecture of the system, where logic execution is handled by a centralized, long-lived `agent-server`. The server is responsible for orchestrating, executing, and managing interactive sessions, providing a unified view of the state for all clients. System interaction occurs through a strict event protocol (`Envelope`), which allows clients to interact with the agent core via defined interfaces. The architecture supports various operating modes—from autonomous startup to deep interactive control—as well as session migration mechanisms between hosts to ensure continuity.

## agent-server — one host-process per machine

All execution logic resides in the long-lived `agent-server` process. ALL surfaces are thin clients of a single event protocol; no client calls the agent core directly.

**Discovery / single-instance:** Upon startup, the server writes a port-file (`~/.nitra/server.port`: port + pid + token-hash) and holds a lock-file. The application, before starting its own server, reads the port-file and attempts a `ClientHello`; if alive → connects as a client; stale lock → overwrites and starts its own. No matter how many applications are started, there is only one agent-server.

The `agent-server` combines three roles (formerly separate MT processes):

| Role | Responsibilities |
| --- | --- |
| **Orchestrator** (formerly `mt watch`) | graph scan, ready-nodes, dispatch runners/audits, composite aggregation, cleanup |
| **Runner** (formerly `mt run` wrapper) | claim → worktree → agent → publish → release; budgets, watchdog, telemetry |
| **Session host** (NEW) | interactive sessions: broadcast Envelope to clients, replay, approvals, preview |

**Client Transports:** (a) local WS `ws://127.0.0.1:{port}` with a one-time token; (b) in-process channel (embedding in the desktop application); (c) relay-client — outgoing wss:// to the relay for remote clients. Reconnect with backoff.

### Signing CLI Executors (`agent_cli`)

The Runner executes the agent node in **only one** way—a headless launch of one of the **signing CLIs** that the user has authorized locally with their **own subscription** (`claude` / `codex login` / `cursor-agent login`). MT does not hold API keys or bill tokens: auth, model selection, tools, and sandbox are brought by the vendor CLI; MT handles all orchestration (claim/lease, worktree isolation, budget/timeout, `## Check`, fenced publish).

| `agent_cli` | Executor | Tier Model |
| --- | --- | --- |
| `claude` (default) | Claude Code (Anthropic subscription) | `MT_AGENT_CLI_MODEL_MAP.claude[tier]` |
| `codex` | Codex CLI (OpenAI subscription) | `MT_AGENT_CLI_MODEL_MAP.codex[tier]` |
| `cursor` | Cursor CLI (Cursor subscription) | `MT_AGENT_CLI_MODEL_MAP.cursor[tier]` |
| `pi` | pi.dev CLI — **local models**: wraps the omlx-server | `MT_AGENT_CLI_MODEL_MAP.pi[tier]` |

**Executor Configuration — user-level, via ENV.** Subscriptions, CLIs, and model maps are **user** properties, common to all their repositories, so they live in the user's environment, not in a repo-scoped `.mt.json`:

```bash
# ~/.zshenv (user level — all repositories)
export MT_AGENT_CLI="claude"                       # default executor
export MT_CLOUD_AGENT_CLIS="codex,cursor"          # cascade of cloud subscriptions (order = priority)
export MT_AGENT_CLI_MODEL_MAP='{"codex":{"MIN":"gpt-5.6-luna","AVG":"gpt-5.6-terra","MAX":"gpt-5.6-sola"},"pi":{"MIN":"omlx/gemma-4-e2b-it-4bit"}}'
```

**Tier-algorithm resolves a specific model per-CLI.** The MIN/AVG/MAX canon is common for all executors; the map "tier → CLI model" is defined by `MT_AGENT_CLI_MODEL_MAP`. The retry ladder escalates the tier → and thus, the specific model → using the same map. Without mapping, the model flag is not passed (CLI resolves itself via subscription); the tier always goes as an env hint `MT_MODEL_TIER`. The rule is the same for all transports: headless invocation and ACP session receive the same resolved model.

CLI Selection: `a.md` section `## Agent cli` (per-node — cross-programmatic dimension [meta](../vision.en.md)) → env `MT_AGENT_CLI` → `claude`. Unknown value → fail-fast to worktree creation. The chosen CLI is reported in the run env as `MT_AGENT_CLI`. Success = `fact_NNN.md` exists **and** `## Check` passes.

**Subscription Rule (Normative).** The Run is executed **on the host where the node owner itself authorized the CLI**. Subscriptions are not pooled or proxied through the relay or server → the relay only passes events and approvals; session migration "transfer here" means transferring execution to the device with the owner's subscription. Subscription rate limits are an external resource: the orchestrator performs a backoff against them, not deepening parallelism.

**Cloud Subscription Cascade (`MT_CLOUD_AGENT_CLIS`).** A user can have several cloud subscriptions simultaneously (e.g., codex and cursor). `MT_CLOUD_AGENT_CLIS` is an **ordered** list of connected cloud CLIs by priority of execution. If the CLI launch fails with signs of exhausted subscription limits (rate limit / quota / 429), the runner automatically moves to the next CLI in the cascade → the order `[chosen agent_cli, ...cascade]` without duplicates → until one succeeds or all are tried. The tier model is resolved **per-candidate** using the same map; the actual CLI is fixed in the frontmatter of `run_NNN.md` (`agent_cli`). Non-limiting errors **do not** launch the cascade → this is a standard failed-run and retry ladder.

**ACP — the sole AI-invocation transport.** **All** AI calls go exclusively through **ACP (Agent Client Protocol)**: one ACP client in `agent-server`, without vendor adapters and without its own provider layer; cloud CLIs connect with their ACP adapters, **local models → via pi.dev CLI**, which wraps the omlx-server and exposes the same ACP. `permission-request` ACP maps to `ApprovalRequest` (Ed25519 signatures) → mid-run gates work over any executor, including local; structured ACP limit errors feed the cascade instead of text heuristics.

**ACP Adapters for `agent_cli` (verified with live sessions 2026-07-16).** None of the four CLIs has a built-in ACP mode in `--help`, except Cursor:

| `agent_cli` | Command for `MT_ACP_AGENT_CMD` | Status |
| --- | --- | --- |
| `cursor` | `agent acp` | native ACP CLI server, official, live session ✅ |
| `codex` | `npx -y @agentclientprotocol/codex-acp@latest` | official bridge (`@agentclientprotocol`), live session ✅ |
| `claude` | `npx -y @agentclientprotocol/claude-agent-acp@latest` | official bridge (successor to deprecated `@zed-industries/claude-code-acp`), live session ✅ |
| `pi` | *(none official)* — third-party `pi-acp@0.0.31` (`svkozak/pi-acp`) bridges `pi --mode rpc` to ACP; this is the exact package used by the official ACP Registry Zed for Pi (`zed.dev/acp/agent/pi` → `npx pi-acp@0.0.31`) | full flow (prompt → response) live session ✅ (with local omlx-server running → default session model `omlx/gemma-4-e4b-it-OptiQ-4bit`) |

**Fixed: `pi` banner in first response (`pi-acp`).** `pi-acp` intentionally captures the non-JSON-parsable prelude on stdout of `pi` (author comment: "capture it so the ACP adapter can surface it on session start") and sends it as `agent_message_chunk` immediately after `session/new`, before the first prompt → the same wire format as in a real response. In Zed, this is not confused with the response because the client maintains a persistent notification listener for the entire session (the session opens before the first user message, the banner becomes the first line of an empty thread), rather than reading the stream only inside the specific request loop.

`agent-core::AcpClient` (`crates/agent-core/src/acp.rs`) is now built similarly: reading the stream → a background tokio-task for the entire client lifetime, not tied to a specific call (`call()` reads from the channel where the reader places classified frames). `session/new` additionally drains notifications queued during `SETTLE_TIMEOUT` (150ms) before returning control → thus the prelude banner no longer sticks to the first `prompt()`. Verified with live session using `pi-acp@0.0.31`: the first response is only the flow text, without a banner.

Discovered and fixed discrepancy: ACP-spec requires an **absolute** `cwd` in `session/new` (`NewSessionRequest.cwd: "Must be an absolute path"`). `agent-core`/`agent-server` used `"."` literally for `workdir` (M1 CLI without graph/worktree) → `agent acp` and `codex-acp` tolerate this, but `claude-agent-acp` strictly validates and rejects the request (`Invalid params: cwd must be an absolute path`). Fixed in `AcpTurnRunner::open_room` (`crates/agent-server/src/runner.rs`): without `workdir`, `std::env::current_dir()` is now used.

**Telemetry.** tokens/cost from the external CLI is best-effort (what the CLI returns is what ends up in `run_NNN.md`); budgets for the subscription path → soft-alert, hard limit remains `budget_hard_sec` (kill by timeout).

Historical point of extension "external node executor" (`.mt.json` `node_executor`, used `n-cursor mt-run-node`) has been removed: after "ACP — the sole AI-invocation transport," external consumers (including local models) are covered by the same CLI path (`pi` for omlx) and user-level ENV config → a parallel execution path is no longer needed.

## Wake: push instead of polling

The basic MT used to wake up via cron every 5 min. In the target architecture:

1. **Relay push "new events in task X"** → agent-server immediately rescans the relevant node;
2. `post-merge` git hook → `mt run --auto` + `touch .mt/wake` (local merges);
3. **Cron/periodic rescan — fallback** (relay unavailable → system works like basic MT).

`mt watch` logic (dispatch, unresolvable alerts, GC) runs on every wake. Sorting the `waiting` queue: leaf nodes → `deadline` → `created_at`.

## Event Protocol

Client↔Host Contract. `PROTOCOL_VERSION = 4` (v1/v2 — scaffold-spec history; v3 — intermediate draft without `lang`; incompatible versions → explicit error with upgrade hint).

### Envelope

```
Envelope {
  seq: u64                    // monotonic within a run; assigns a claim holder
  ts: DateTime<Utc>
  node_hash: string           // room/node address
  run_token: uuid             // = claim token; session identifier
  device_id: uuid?            // who initiated (for client events)
  account_id: uuid?           // multiple participants in shared tasks
  event: Event
}
```

`session.jsonl` is an append-only list of Envelopes (ephemeral ones: `PreviewScreenshot`, `AgentTextDelta` do not need logging — the `AgentTextDone` aggregate is logged).

### Events

```
// client → host
UserMessage      { text, attachments[], surface?: string }
                 // surface-hint: "designer" | "writer" | "cli" | … —
                 // agent can suggest the appropriate provider/prompt profile
ContextSelected  { kind: string, payload: json, bounding_box?: Rect }
                 // "dom_element" | "text_range" | "file_region" | … —
                 // context that the user "clicked" on, regardless of the application
ApprovalResponse { request_id, approved, signature: bytes }
                 // Ed25519 signature from the device over (request_id, approved, node_hash, run_token);
                 // the device can belong to ANOTHER account with approver+ role
CancelTurn       {}
DoneSession      {}   // finish a run: host executes mt done semantics —
                      // fenced publish fact in main (v4-minor)
ReleaseSession   {}   // pause/release: CAS-delete claim; log remains
                      // in run ref as recovery base (v4-minor)

// host → clients
AgentTextDelta   { text }
AgentTextDone    {}
ToolCall         { call_id, name, args }
ToolResult       { call_id, ok, summary }
ApprovalRequest  { request_id, action, diff? }
PreviewScreenshot{ ref_id, mime }     // EPHEMERAL: relay/WS only, never in git;
                                      // only to clients with "preview" capability
FileChanged      { path }
Committed        { commit_hash, message }
NodeState        { path, state, claim?: {holder_device, lease_until, generation} }
                 // derived state of the node — for session and mt-dashboard
ClaimChanged     { node_hash, holder_device_id?, lease_until?, generation }
                 // broadcast via relay; source of truth — git ref
MemberChanged    { account_id, role? }   // None = deleted
PlanReview       { plan_ref }            // composite plan awaits approval
AuditPending     { fact_ref }            // fact awaits verdict from human auditor
Error            { message }
```

### Handshake

```
ClientHello {
  protocol_version, device_id, device_token,
  client_kind: "designer" | "writer" | "cli" | "mobile" | "mt-dashboard" | …,
  client_capabilities: ["preview", "approvals", "diff_view", "self-translate", …],
  lang: string,                       // REQUIRED (v4): BCP-47 language of the participant
  want_replay_from: Option<seq>,
}
→ ServerHello { protocol_version, session_list }
```

The server **filters events by capabilities** (PreviewScreenshot → only "preview"). `lang` controls live translation: a client without the `self-translate` capability receives text events already translated into its language; with `self-translate` — the original (it translates itself). Details — [i18n.md](i18n.en.md). Replay: live tail from memory (buffer), deeper → from the `session.jsonl` run ref.

### Error Branches and Backpressure

- **Reconnect:** the client saves the last processed `seq` and reconnects with `want_replay_from`; `seq` is monotonic — no gaps in logged events. Deepness beyond the buffer → host reads from the `session.jsonl` run ref.
- **Backpressure:** for a slow client, the host **drops only ephemeral** events (`AgentTextDelta`, `PreviewScreenshot`) — logged events are always delivered; send queue overflow → forced disconnect with `Error`, client reverts to replay. Frame limit — 2 MB (shared with relay).
- **`PreviewScreenshot` bytes:** the event carries only `ref_id`; the client fetches the bytes separately from the host (local HTTP preview module or binary WS frame by `ref_id`) — large binaries do not pass through the event stream and relay buffer.
- **Unknown `Event` variant** within a compatible major version → the client **ignores** (forward-compatibility of minor extensions); incompatible `protocol_version` → rejection at handshake.

### `mt-dashboard`

A specialized `client_kind`: subscribes not to one run, but to a **subtree of nodes** (rooms by `node_hash`); receives `NodeState`/`ClaimChanged`/`PlanReview`/`AuditPending`/`Committed` without chat stream. This is in response to "seeing the entire graph as one picture": aggregation on the client, not a single session type.

## Interactive Session = Node Run

Lifecycle:

```
mt attach <node>  (or UI "open task")
  → host: CAS claim (interactive: true) → worktree from base_sha
  → clients connect (locally/via relay), receive replay
  → each move: UserMessage → agent → ToolCall/ApprovalRequest/…
      → commit (files + session.jsonl) → push run ref
  → completion:
      mt done  → ## Check → fenced publish fact in main (+ archive ref)
      pause    → renewal stops → claim expires → node waiting/stalled
      handoff  → migration to another host (below)
```

Interactive mode affects policies: `progress_timeout_sec` is inactive (person thinking), budgets are soft-alert rather than kill; `run_NNN.md` is written the same way (telemetry wall\_sec/tokens/cost — from moves).

**Node in two modes:** the same task can start as autonomous (classic MT) and be "picked up" in chat (person interactively opens a failed node — this is a new run with the same contract), and vice versa: an interactively started task can be left to autonomous retry.

## Session Migration Between Hosts ("Move Here")

```
1. New host (role host+, git-access): sends via relay HandoffRequest{node_hash}
2. Claim holder: finishes the current turn → commit + push run ref
   → writes run_NNN.md (result: handoff) → CAS-delete claim → ack
3. New host: CAS-create claim (new token, generation+1)
   → fetches old run ref → worktree checkout from its tip
   → replays session.jsonl → continues conversation (run N+1, log inherited)
4. Relay unavailable / holder dead → MT path: wait for lease expiry + grace
   → takeover; log restored from the last pushed run ref
   (most of the unfinished turn is lost)
```

Clients do not manually reconnect anywhere: the relay broadcasts `ClaimChanged`, and clients continue in the same room with the new active host.

## Preview — Capability-based Module

Preview is an optional module for interactive run, activated by project type:

- `PreviewBackend { start(worktree) → PreviewHandle }`; reference → `HtmlPreview`: static HTTP server over worktree + inject picker script + WebSocket live reload (watcher) + endpoint that broadcasts element selection as `ContextSelected { kind: "dom_element" }`;
- `PreviewScreenshot` is shared only with clients having `"preview"` capability; never persists;
- Other surfaces send their `ContextSelected` (text\_range, file\_region) directly through the transport.
