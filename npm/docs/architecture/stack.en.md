---
type: layered-translation
source: architecture/stack.md
lang: en
sourceFileCrc: 27ebbe5f
authored: false
translated: 2026-07-22
model: openai-codex/gpt-5.5
---

# Nitra MT — Reference Stack

> Supplement to the [target architecture](index.md) 0.3.0-draft. The architecture is technology-agnostic; this document records the specific technology decisions of the reference implementation and their rationale. Changing the stack does not change the architecture.

## Essence

This document records the technology decisions that implement the reference stack for Nitra MT, serving as a supplement to the general architecture. The main logical graph contract is fully encapsulated in `@7n/mt` (Bun/JS), ensuring consistency of business rules. Rust components implement the long-lived host process, using this contract through subprocess calls rather than reimplementation. All infrastructure, from LLM providers to connection mechanisms, is standardized around OpenAI-compatible transport and explicit isolation boundaries between components.

Changelog:

## Components

| Component | Stack | Status |
| --- | --- | --- |
| `@7n/mt` — graph CLI surface: thin client for the Rust core (`mt-core` via napi) | Bun + plain JS/JSDoc over `mt-core` | exists (0.2.x) |
| `mt-core` — graph core: scan, create, claim CAS, fenced publish, run wrapper | Rust crate (`serde`, `chrono`, `sha2`) | exists |
| `agent-protocol` — Envelope/Event, signatures, protocol version | Rust crate (`serde`, `ed25519-dalek`; without tokio/tauri) | planned |
| `agent-core` — ACP client (Agent Client Protocol) for external CLI executors | Rust crate (`tokio`; ndjson JSON-RPC, v1 subset: initialize/session/prompt/request_permission) | exists (skeleton) |
| `agent-server` — host process: sessions, transports, relay client, discovery | Rust crate (`axum`, `tokio-tungstenite`, `reqwest`) | planned |
| `agent-cli` — thin client + headless (`mt serve`/`attach` frontend) | Rust binary (`clap`) | planned |
| Desktop apps (macOS) | Tauri v2 — thin client + lifecycle agent-server | planned |
| Mobile (Android) | Tauri v2 — client ONLY via relay | planned |
| `ui/` — shared frontend for surfaces | Vue 3 + Vite, plain JS + JSDoc (NO TypeScript) | planned |
| `relay/` | Bun service, plain JS + JSDoc; PostgreSQL | planned |

## Single Contract Code Rule

The graph contract logic (claim CAS, fenced publish, scan, run wrapper, file schemas) is implemented **once** — in the Rust core `mt-core`. Both consumers use the same implementation without subprocesses: `@7n/mt` — a thin client via a napi addon (`crates/mt-napi`), `agent-server` — links `mt-core` as a crate (`graph.rs`). The JS layer is **not** a second implementation: it only retains argv, config path resolution, and error mapping to exit codes. The Rust layer is additionally responsible for what `@7n/mt` does not have: a long-lived process, sessions/broadcast, transports, preview, signatures, and ACP sessions for executors.

- Pro: divergence between two implementations of fenced publish and run orchestration is impossible.
- Con: the JS surface needs a napi artifact for the platform (platform subpackages + dev fallback `cargo build`).
- History: initially, the contract lived in `@7n/mt` (JS), and agent-server was supposed to call `mt … --json`; moving it to Rust — ADR `260714-0710` (run wrapper; scan was moved earlier, ADR `20260613-071723`).

## Contract as a Package: `@7n/mt-contract` + conformance-suite

The contract (file state in git + canonical JSON scan) is the only interface between layers: Rust (`mt-core`) is the only implementation, the JS layer is not a second implementation but a thin client over the Rust engine. To make this boundary testable rather than declarative, the contract is recorded as a separate package `npm/contract/` (`@7n/mt-contract`, `private: true`):

- **`schemas/`** — JSON Schema: frontmatter `task.md`, sentinel files, layout `deps/`; canonical scan output (`TaskNode[]`); flat adapter output (`TaskInfo[]`);
- **`states.md`** — normative snapshot of states and transitions (current summary; ADRs remain the history of decisions);
- **`fixtures/cases/<name>/`** — golden cases: `mt/` (input tree) + `expected/scan.json` + `expected/flat.json`;
- **`lib/`** — conformance runner (ajv validation + expected/actual comparison).

Both consumers are checked **independently**, with fixtures as the shared source of truth: Rust tests run scan over `cases/*/mt/` against `expected/scan.json` (“I scan the FS correctly”); JS tests feed `scan.json` into the flatten/kebab adapter against `expected/flat.json` **without running Rust** (“I adapt correctly”). Divergence between implementations is caught case by case and with a clear culprit.

- **Contract semver:** major — change in state semantics or format; minor — back-compatible addition; patch — new fixtures/text clarifications.
- **Implementation** — two add-only PRs: package with schemas/fixtures/runner → conformance test in Rust CI (divergences it detects are contract calibration). Nothing is moved or renamed.
- **Unchanged:** state semantics and file contract format (only recorded), platform artifact delivery model, addon lookup order.
- **Publication to registry** — a separate decision when an external consumer appears; at that point, revisit the question of including the agent protocol schema (`agent-protocol`) in the contract.

## Physical Boundaries (Checked in CI)

- `agent-core` MUST NOT depend on `tauri` — CI fails if `cargo tree -p agent-core -e normal` contains `tauri`;
- `agent-protocol` without tokio/tauri — pure contract;
- relay MUST NOT import anything from agent-* — it communicates only through the protocol.

## Executors and AI Transport

- **Executors are subscription CLIs** (`agent_cli`: claude | codex | cursor | pi; [runtime.md](runtime.en.md#підписочні-cli-виконавці-agent_cli)): auth, model selection, tools, and billing are on the CLI side under the user’s subscription. MT does not hold keys; there is **no** custom provider layer or LiteLLM proxy (removed).
- **Local models — pi.dev CLI over omlx**: pi wraps a local omlx server and is the same kind of executor (`agent_cli: pi`) as cloud ones.
- **Executor configuration — user-level ENV** (`MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`, `MT_AGENT_CLI_MODEL_MAP`), not `.mt.json`: subscriptions and models are a user property shared across all repositories.
- **Multiple cloud subscriptions — cascade** `MT_CLOUD_AGENT_CLIS`: exhausted limits of one CLI → automatic switch to the next.
- MIN/AVG/MAX are the canonical tiers: tier resolves to a specific CLI model through `MT_AGENT_CLI_MODEL_MAP[<cli>][tier]`; without mapping, the CLI decides itself (tier is the hint `MT_MODEL_TIER`).
- **ACP (Agent Client Protocol) is the single transport for all AI calls**: one ACP client in agent-server; `permission-request` → `ApprovalRequest` (Ed25519).
- MCP tools are connected through the standard `mcp_servers` mechanism of the CLIs themselves (declaration — surfaces.md); MT has no custom MCP implementation.

## Git Operations

- Desktop/servers: system `git` via subprocess (as in `@7n/mt`);
- Android: `gix` (feature `android`) — mobile is still client ONLY; git may only be needed for future read-only scenarios.

## Keys and Keystore

- macOS: Keychain; Android: Keystore; Linux/headless: 0600 file (fallback);
- scaffold starts with file fallback + TODO for platform keystores.

## Relay Infrastructure

- Bun + PostgreSQL; auth — interface `verifySession(token) → {account_id}` with a dev implementation (magic tokens), production — Ory Kratos behind the same interface;
- Push: FCM (data messages of three types — see [access.md](access.en.md)); module behind an interface, dev stub;
- Deployment: Dockerfile (oven/bun) + k8s (Deployment + Service; Postgres — CNPG);
- Limits: connection rate limit, frame ≤ 2 MB, buffer ≤ 200 Envelope/run.

## agent-server Daemonization

- macOS: launchd plist; Linux: systemd unit (examples in `deploy/`);
- discovery port-file: `~/.nitra/server.port` (port + pid + token hash) + lock file.

## CI

- Rust: `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace` (no network: ScriptedTurnRunner, local bare repo as remote);
- agent-core ↔ tauri boundary check (above);
- Bun: `bun test` for relay and `@7n/mt`; key cases: CAS conflict between two hosts, takeover of an expired claim, handoff, membership routing of rooms, viewer does not send client events, invite→accept→MemberChanged flow, transfer ownership, rejection of a device signature outside the pubkey list, rejection of incompatible protocol_version;
- Tauri: `cargo check` for both apps; build jobs are stubs until stabilization.

## Language

Code comments and documentation are in Ukrainian; identifiers, commit messages for contract files, event/field names are in English.

## Reference Codebases (for decisions, not copying)

- `openai/codex` (codex-rs) — App Server: JSON-RPC server as the single owner of threads, surfaces are thin clients;
- `aaif-goose/goose` — workspace structure (core/cli/server/mcp), sessions/providers/config;
- `Dicklesworthstone/pi_agent_rust` — agent loop: message history, tool iteration, event callbacks.
