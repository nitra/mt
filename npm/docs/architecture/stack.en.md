---
type: layered-translation
source: architecture/stack.md
lang: en
sourceFileCrc: 7b05785f
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Nitra MT — reference stack

> An addendum to [target architecture](index.md) 0.3.0-draft. The architecture is technology-agnostic; this document records specific technological decisions of the reference implementation and their rationale. Changing the stack does not change the architecture.

## Core Idea

This document records the technological decisions that implement the reference stack for Nitra MT, serving as an addendum to the general architecture. The main logical contract of the graph is fully encapsulated in `@7n/mt` (Bun/JS), ensuring the consistency of business rules. Rust components implement the long-lived host process using this contract through subprocess calls, not re-implementation. The entire infrastructure, from LLM providers to connection mechanisms, is standardized around an OpenAI-compatible transport and explicit isolation boundaries between components.

Changelog:

## Components

| Component | Stack | Status |
| --- | --- | --- |
| `@7n/mt` — graph core: CLI, claim/fenced publish, scan, wrapper | Bun + plain JS/JSDoc | exists (0.2.x) |
| `agent-protocol` — Envelope/Event, signatures, protocol version | Rust crate (`serde`, `ed25519-dalek`; without tokio/tauri) | planned |
| `agent-core` — agent loop, tools, provider, preview | Rust crate (`tokio`, `async-openai`, `schemars`, `notify`, `gix` feature-gated) | planned |
| `agent-server` — host process: sessions, transports, relay-client, discovery | Rust crate (`axum`, `tokio-tungstenite`, `reqwest`) | planned |
| `agent-cli` — thin client + headless (`mt serve`/`attach` frontend) | Rust binary (`clap`) | planned |
| Desktop applications (macOS) | Tauri v2 — thin client + lifecycle agent-server | planned |
| Mobile (Android) | Tauri v2 — CLIENT only via relay | planned |
| `ui/` — common frontend surfaces | Vue 3 + Vite, plain JS + JSDoc (WITHOUT TypeScript) | planned |
| `relay/` | Bun service, plain JS + JSDoc; PostgreSQL | planned |

## One Code Contract Rule

The graph contract logic (claim CAS, fenced publish, scan, file schemas) is implemented **once** — in `@7n/mt`. `agent-server` (Rust) **does not re-implement** it: it calls `mt … --json` as a subprocess for graph operations. The Rust layer is responsible for what is missing in `@7n/mt`: the long-lived process, sessions/broadcast, transports, preview, signatures, provider-streaming.

- Pro: Impossible divergence of two implementations of fenced publish.
- Con: `agent-server` dependency on Bun in PATH — fixed in discovery/preflight (`mt doctor` check).
- Solution review (moving the contract to Rust) — a separate ADR, only after protocol stabilization.

## Physical Boundaries (checked in CI)

- `agent-core` does NOT depend on `tauri` — CI failure if `cargo tree -p agent-core -e normal` contains `tauri`;
- `agent-protocol` without tokio/tauri — pure contract;
- `async-openai` types do not leak to provider-implementation; `CompletionRequest` — neutral;
- relay does NOT import anything from `agent-*` — communicates only via protocol.

## LLM Providers

- Transport — **OpenAI-compatible Chat Completions** (`async-openai`, `base_url` via config) as the minimum common denominator: omlx, Ollama, LM Studio, LiteLLM.
- Cloud models (Anthropic and others) — via LiteLLM profile; `model_map` (MIM/AVG/MAX) from `.mt.json` resolves to `provider_profiles`.
- Tool schemas — derive (`schemars`), not manually; do not manually write SSE parsing and tool call assembly.
- MCP: use `register_external(...)` in the tools registry + commented out `rmcp`; do not write a custom MCP implementation.

## Git Operations

- Desktop/servers: system `git` via subprocess (as in `@7n/mt`);
- Android: `gix` (feature `android`) — mobile is still CLIENT, git is only needed for read-only future scenarios.

## Keys and Keystore

- macOS: Keychain; Android: Keystore; Linux/headless: 0600 file (fallback);
- The scaffold starts with file fallback + TODO for platform keystores.

## Relay Infrastructure

- Bun + PostgreSQL; auth — `verifySession(token) → {account_id}` interface with dev implementation (magic tokens), production — Ory Kratos using the same interface;
- Push: FCM (three types of data messages — see [access.md](access.en.md)); module via interface, dev stub;
- Deployment: Dockerfile (oven/bun) + k8s (Deployment + Service; Postgres — CNPG);
- Limits: connection rate limit, frame ≤ 2 MB, buffer ≤ 200 Envelope/run.

## Daemonization of agent-server

- macOS: launchd plist; Linux: systemd unit (examples in `deploy/`);
- discovery port-file: `~/.nitra/server.port` (port + pid + token-hash) + lock-file.

## CI

- Rust: `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace` (without network: MockProvider, local bare-repo as remote);
- Checking the boundary of agent-core ↔ tauri (above);
- Bun: `bun test` for relay and `@7n/mt`; key cases: CAS-conflict of two hosts, takeover of expired claim, handoff, room membership routing, viewer does not send client events, invite→accept→MemberChanged flow, transfer ownership, rejection of device signature outside pubkey list, rejection of incompatible protocol_version;
- Tauri: `cargo check` for both applications; build jobs — stubs until stabilization.

## Language

Code comments and documentation — in Ukrainian; identifiers, contract file commit messages, event/field names — in English.

## Reference Codebases (for decisions, not for copying)

- `openai/codex` (codex-rs) — App Server: JSON-RPC server as the single owner of threads, frontend — thin clients;
- `aaif-goose/goose` — workspace structure (core/cli/server/mcp), sessions/providers/config;
- `Dicklesworthstone/pi_agent_rust` — agent loop: message history, tool iteration, event callbacks.
