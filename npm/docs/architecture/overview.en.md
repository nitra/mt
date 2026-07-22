---
type: layered-translation
source: architecture/overview.md
lang: en
sourceFileCrc: 410525c6
authored: false
translated: 2026-07-22
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Overview: Merging and System Layer Solutions

> Target architecture **0.3.0-draft** — [content](index.md). Unifies the task graph (`mt.md` 0.2.0 — removed on M1, git history) and scaffold-spec v4 (devices/sessions). The document is technology-agnostic; the reference stack is [stack.md](stack.en.md).

## Core Idea

This is an architectural description that defines the general structure of the system, based on Git as the single source of truth. It ensures reliability through cryptographic signatures, reducing complex operations to atomic transactions. The system ensures separation of concerns between layers: from persistent storage in Git to ephemeral coordination via Relay. Thus, this guarantees high resilience and a transparent audit trail for all decisions.

## Merging Solutions (Normative)

Both previous architectures converged independently on the git substrate, "single quill," worktree isolation, and human escalation. Conflicts were resolved as follows:

1. **Git CAS claim — the single source of truth "single quill."** `refs/mt/claims/*` are authoritative for all modes—autonomous and interactive. Relay lease **does not issue**: it only transmits `ClaimChanged` and accelerates handoff notifications. Relay failure → degradation to polling; nothing breaks.
2. **Interactive session = node run.** A chat session is not a separate entity, but a run of the MT node with connected clients. `session.jsonl` (conversation log) lives in the run ref and is pushed **every turn** — this is the migration mechanism between devices and handover. Only the distilled `fact_NNN.md` reaches `main`.
3. **Approvals — one cryptographic mechanism across three gates.** Ed25519 signatures of devices are applied to plan-reviews (`mt spawn --approve`), audit verdicts, and new mid-run approvals of destructive tool calls. Signatures materialize into node files — git receives a cryptographic audit trail.
4. **Relay — ephemeral coordinator, not storage.** Presence, membership, event forwarding, push, live-tail buffer. DOES NOT store logs, DOES NOT proxy git, DOES NOT issue leases.
5. **Viewing the subgraph as one conversation — this is `client_kind: "mt-dashboard"`**, a specialized client, not a separate session type.
6. **One contract code.** Claim/fenced publish/scan logic exists in one implementation; other components call it, rather than duplicating it (see [stack.md](stack.en.md)).

---

## Big Picture

```
                          ┌──────────────────────────────┐
                          │   git remote (GitHub/Gitea)  │
                          │  main ── distilled state  │
   Layer 0: truth          │  refs/mt/claims/*  ── quill   │
                          │  refs/mt/runs/*    ── log │
                          │  refs/mt/archive/* ── archive  │
                          └──────┬───────────────┬───────┘
                    fetch/push   │               │   fetch/push
                          ┌──────┴──────┐  ┌─────┴───────┐
   Layer 1: hosts           │ agent-server│  │ agent-server│   one process
   (execution)            │  (machine A) │  │ (server B)  │   on machine
                          └──┬───────┬──┘  └──────┬──────┘
              local WS / │       │ wss        │ wss
              in-process     │       └─────┬──────┘
                          ┌──┴──┐    ┌─────┴─────────────┐
   Layer 2: relay           │     │    │ relay: accounts,   │  ephemeral:
   (live coordination)     │     │    │ membership,       │  events, presence,
                          │     │    │ presence, push    │  push, buffer
                          │     │    └─────┬─────────────┘
                          │     │          │ wss
   Layer 3: surfaces     ┌──┴─────┴──────────┴────────────────┐
   (thin clients)     │ desktop applications · CLI/TUI · mobile │
                       │ mt-dashboard · viewer of other people  │
                       └────────────────────────────────────┘
```

- **Layer 0 — git remote.** Slow, reliable, complete state: task graph in `main`, claims, run logs, archives. Works without all other layers.
- **Layer 1 — hosts.** On each machine (laptop, server, CI-runner), there is one `agent-server` process: orchestrates (`watch`), runs (`runner`), maintains interactive sessions, distributes events to clients.
- **Layer 2 — relay.** Fast, ephemeral: who is online, who is in the task, live deltas, signed approvals, push "wake up". The only persistent data is accounts/membership/invitations.
- **Layer 3 — surfaces.** Any UI — an equal thin client of one event protocol: desktop applications of different specializations, CLI, phone, dashboard. No client executes the agent itself.

## Glossary

| Term | One-line definition | Chapter |
| --- | --- | --- |
| **node** | unit of work: directory with `task.md`; atomic or composite (subgraph) | [graph.md](graph.en.md) |
| **fact** | immutable result of a successful run; the only thing dependent nodes see | [graph.md](graph.en.md) |
| **claim** | git-ref "single quill": who currently has the right to execute and publish the node | [git.md](git.en.md) |
| **fenced publish** | atomic push of the result to `main` + deletion of claim/run ref with one `--atomic` | [git.md](git.en.md) |
| **run ref** | working state branch (`refs/mt/runs/...`); for sessions — with `session.jsonl` log | [git.md](git.en.md) |
| **checkpoint-handoff** | transfer of a session without conversation history: state + summary, log remains with the author | [git.md](git.en.md) |
| **agent-server** | single host process of the machine: orchestrator + runner + session host | [runtime.md](runtime.en.md) |
| **Envelope** | unit of client↔host event protocol (v4) | [runtime.md](runtime.en.md) |
| **surface** | named profile of agent specialization (designer/writer/cli) | [surfaces.md](surfaces.en.md) |
| **relay** | ephemeral coordinator: accounts, membership, presence, event forwarding, push | [access.md](access.en.md) |
| **approver** | role of a participant who signs approvals from any device **without git access** | [access.md](access.en.md) |
| **base-language** | canonical language of the content in `main`; translations — derived in `refs/mt/i18n/*` | [i18n.md](i18n.en.md) |
| **authored-translation** | version of the language of the author of the edit; protected against overwriting by back-translation | [i18n.md](i18n.en.md) |
| **template** | mutable description of a recurring task outside the graph (`.mt/templates/<name>/`); not a node | [recurrence.md](recurrence.md) |
| **instance** | normal root node, materialized from a template upon schedule triggering | [recurrence.md](recurrence.md) |
| **mandate** | area where the owner decides independently without escalation (`.mt/mandates.yaml`) | [mandates.md](mandates.md) |
| **decision-request** | packaged fork for the owner: context, options, agent recommendation | [mandates.md](mandates.md) |
| **leverage-facets** | declarative fields of the fork (irreversibility, blast radius, divergence, cost) with determined mapping to escalation mode | [mandates.md](mandates.md) |
| **process watcher** | node actor that monitors stuck claims and SLA `decision-request` — first signals the executor | [mandates.md](mandates.md) |
