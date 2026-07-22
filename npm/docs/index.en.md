---
type: layered-translation
source: index.md
lang: en
sourceFileCrc: 6db701f5
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Nitra MT — Documentation

This list is essentially a task list. Its goal is to organize tasks so that they can be executed by both humans and artificial intelligence. These different participants (humans and AI) work together to achieve the set goal.

The platform that manages this ensures that any task will be executed equally well, regardless of where you run it or what language you use. All data and changes are controlled using a version control system that serves as a single, reliable source of truth for the entire system.

The server acts as the main conductor, organizing the work. Specialized parts of the system create the necessary environment and context so that each element—be it a human or an AI—can understand what needs to be done.

→ More details: [How it works](overview/index.en.md)

🇺🇦 [Українська](index.md)

## Dive Deeper

The documentation is built in layers—from the summary at the top to detailed chapters at the bottom. Each level is self-sufficient; dive in where you are interested:

* [How it works](overview/index.en.md) — the entire system in one glance
* Thematic overviews: [Purpose and direction](overview/direction.en.md) · [Core: graph and git](overview/core.en.md) · [Execution](overview/runtime.en.md) · [People, access, support](overview/people.en.md)
* Detailed chapters — in the sections below

## Vision

* [Vision: task platform for humans and AI](vision.en.md) - why all this: five cross-dimensions, git as a substrate (not an interface), implications for focus
* [Implementation Roadmap](roadmap.en.md) - M0 core dogfood → M1 agent-server → M2 mission control → M3 dashboard → M4 i18n; milestone = demo criterion

## Target Architecture (0.3.0-draft)

A dynamic, self-modifying task graph: agents and humans execute nodes of the DAG; the state lives in git; coordination is via CAS claims and fenced publish; the target picture adds hosts, devices, interactive sessions, and relay.

Merging the task graph (mt.md 0.2.0) and scaffold-spec v4 (devices/sessions) into a single system. Read in order:

* [Overview](architecture/overview.en.md) - normative solutions for merging and the four-layer picture
* [Core: task graph](architecture/graph.en.md) - nodes and DAG, file contract, derived states, retry ladder, audit
* [Coordination via git](architecture/git.en.md) - CAS claim as the single "pen", run ref with session log, fenced publish
* [Runtime](architecture/runtime.en.md) - agent-server, event protocol v4, interactive sessions, migration between hosts, preview
* [Specialized surfaces](architecture/surfaces.en.md) - surface profiles, MCP tools, connection to sandbox, reference designer/writer/cli
* [People, devices, access](architecture/access.en.md) - relay, membership and roles, three approval gates with Ed25519 signatures, push
* [Internationalization (i18n)](architecture/i18n.en.md) - base canon and derived translations, worktree materialization, contract-aware translator
* [Meta-cycle (retro)](architecture/retro.en.md) - analysis of the audit trail, private opt-in proposals to the executor
* [Operations](architecture/operations.en.md) - CLI, configuration, security model, fault tolerance, end-to-end scenarios
* [Reference Stack](architecture/stack.en.md) - technology decisions for implementation (Rust device-layer, Bun relay/`@7n/mt`)

## History

* [Documentation Change Log](log.md) - chronology of architecture edits
* Frozen contract 0.2.0 (`mt.md`) deprecated at M1: unique content moved to architecture/ chapters (see log 2026-07-11), full text — in git history
