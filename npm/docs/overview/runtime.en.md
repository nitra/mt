---
type: layered-translation
source: overview/runtime.md
lang: en
sourceFileCrc: cfd07e43
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Execution: hosts, sessions, surfaces

## Essence

The system functions through a centralized `agent-server`, which orchestrates and manages interactive sessions via the event protocol (`Envelope`). The architecture supports operating modes and session migration between hosts. Agent operation is defined by specialized "surfaces" (`surfaces`), which configure the context and tools for a specific task. The Nitra MT technological stack is standardized, where business logic is encapsulated in `@7n/mt` (Bun/JS), and the host is implemented in Rust.

## Runtime: hosts, sessions, surfaces

The centralized `agent-server` is responsible for the orchestration and management of interactive sessions. It ensures a unified state for clients, interacting via the event protocol (`Envelope`). Different operating modes and session migration mechanisms between hosts are supported.

## Specialized Surfaces (surfaces)

The system uses different profiles (`surfaces`) to optimize the AI agent for a specific task (e.g., design or command line). Each surface configures the context, allowed tools, and prompting systems, thereby reducing context overhead.

## Nitra MT — Reference Stack

The logical contract of the graph is encapsulated in `@7n/mt` (Bun/JS), ensuring the uniformity of business rules. The long-lived host process is realized in Rust, which uses this contract via sub-processes. The entire infrastructure is standardized around OpenAI-compatible transport.

## Deeper Dive

- [Runtime: hosts, sessions, surfaces](../architecture/runtime.en.md)
- [Specialized Surfaces (surfaces)](../architecture/surfaces.en.md)
- [Nitra MT — Reference Stack](../architecture/stack.en.md)
