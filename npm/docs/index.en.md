---
type: layered-translation
source: index.md
lang: en
sourceFileCrc: 9fcdbc2c
authored: false
translated: 2026-07-22
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Nitra MT — documentation

This is a way you can tell the system the final goal to be achieved. You define a large task, and then the system breaks it down into smaller parts and finds people or programs (like AI) to perform them.

Everything that happens is recorded in a special version control system (Git), making the process completely transparent and reliable. The system manages the execution as if it were the main dispatcher, coordinating the work of all participants.

This solution is designed so that you can always track the process, regardless of language, and it becomes smarter over time by learning from the experience of every completed task.

→ More details: [How it works](overview/index.en.md)

🇺🇦 [Українська](index.md)

## Deep dive

The documentation is built in layers—from a summary at the top to detailed chapters at the bottom. Each level is self-contained; go down where you are interested:

* [How it works](overview/index.en.md) — the whole system at a glance
* Thematic overviews: [Vision and Path](overview/direction.en.md) · [Core: Graph and Git](overview/core.en.md) · [Runtime](overview/runtime.en.md) · [People, Access, Support](overview/people.en.md)
* Detailed chapters — in the sections below

## Vision

* [Vision: Task platform for humans and AI](vision.en.md) - why all this: five cross-dimensions, Git as a substrate (not an interface), implications for focus
* [Implementation Roadmap](roadmap.en.md) - M0 core dogfood $\to$ M1 agent-server $\to$ M2 mission control $\to$ M3 dashboard $\to$ M4 i18n; milestone = demo criterion

## Target Architecture (0.3.0-draft)

A dynamic, self-modifying task graph: agents and people execute the nodes of the OAG, the state lives in Git, coordination is through CAS claims and fenced publish; the target picture adds hosts, devices, interactive sessions, and relay.

Combining the task graph (mt.md 0.2.0) and scaffold-spec v4 (devices/sessions) into one system. Read in order:

* [Overview](architecture/overview.en.md) - normative decisions on merge and the four-layer general picture
* [Core: Task Graph](architecture/graph.en.md) - nodes and OAG, file contract, derived states, retry ladder, audit
* [Coordination via Git](architecture/git.en.md) - CAS claim as the single "pen", run ref with session log, fenced publish
* [Runtime](architecture/runtime.en.md) - agent-server, event protocol v4, interactive sessions, migration between hosts, preview
* [Specialized Surfaces](architecture/surfaces.en.md) - surface profiles, MCP tools, binding with sandbox, reference designer/writer/cli
* [People, Devices, Access](architecture/access.en.md) - relay, membership and roles, three approval gates with Ed25519 signatures, push
* [Mandates and Human-Centric Escalation](architecture/mandates.md) - mandate map, people and model profiles, decision-request, leverage-based routing, precedent engine
* [Internationalization (i18n)](architecture/i18n.en.md) - base canon and derived translations, worktree materialization, contract-aware translator
* [Meta-cycle (retro)](architecture/retro.en.md) - audit trail analysis, private opt-in proposals to the executor
* [Recurrent Tasks (recurrence)](architecture/recurrence.md) - template + instances: scheduling outside the graph, every trigger is a normal root node
* [Operations](architecture/operations.en.md) - CLI, configuration, security model, fault tolerance, end-to-end scenarios
* [Reference Stack](architecture/stack.en.md) - technological solutions for implementation (Rust device-layer, Bun relay/`@7n/mt`)

## History

* [Documentation Changelog](log.md) - chronology of architecture edits
* Frozen contract 0.2.0 (`mt.md`) deprecated at M1: unique content moved to chapters in architecture/ (see log 2026-07-11), full text — in git history
