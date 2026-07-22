---
type: layered-translation
source: overview/index.md
lang: en
sourceFileCrc: e2599144
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# How It Works

## Essence

The platform provides a universal contract for task execution, guaranteeing functionality regardless of the device or language. The system is built on an architecture with clearly defined layers, where Git serves as the single source of truth. A centralized agent-server orchestrates sessions, and specialized "surfaces" define the context for operation.

## Key Aspects

### Contracts and Universality

The platform uses a universal task contract, ensuring stable operation regardless of the environment or language. This allows for systemic auditing and multi-language support in the core for self-optimization.

### Core and State Management

Functionality is based on a recursive task graph that is dynamically scheduled. Git is used as a reliable source of truth to ensure a transparent audit trail, separating persistent storage from ephemeral coordination.

### Orchestration and Execution

Work is performed via the `agent-server`, which manages interactive sessions using the event protocol (`Envelope`). The task context is configured through specialized "surfaces," and the business logic is encapsulated in the standardized Nitra MT stack (Bun/JS).

### Transparency and Access

The system ensures a high level of transparency, supporting interaction between different devices and participants. This includes multilingual mechanisms and a self-improvement cycle that complies with operational contracts.

## Deeper Dive

- [Goal and Path](direction.en.md)
- [Core: Task Graph and Coordination via Git](core.en.md)
- [Execution: Hosts, Sessions, Surfaces](runtime.en.md)
- [People, Access, Support](people.en.md)
