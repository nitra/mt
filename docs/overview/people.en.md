---
type: layered-translation
source: overview/people.md
lang: en
sourceFileCrc: 35e65830
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# People, Access, Support

## Essence

This overview aggregates the key aspects of the system: interaction between participants and devices, multilingual mechanisms, self-improvement cycle, and operational contracts. The system focuses on high transparency, user control, and architectural resilience.

## Interaction and Security

The architecture defines user roles (from owner to viewer) and authentication mechanisms. The main guarantee is the cryptographic audit of every step, where the Relay only coordinates, without storing critical data.

## Language Support and Canon

Multilingualism is implemented through derived data tied to a single, immutable base canon using hashes. All language work is managed by a separate repository.

## Automation and Operations

The system has a retrospective self-improvement cycle that analyzes historical data and suggests optimizations for manual implementation. The operational contract guarantees fault tolerance and a clear command-line interface.

## Deeper Dive

- [People, Devices, Access](../architecture/access.en.md)
- [Multilingualism (i18n)](../architecture/i18n.en.md)
- [Meta-cycle: Retrospective Self-Improvement](../architecture/retro.en.md)
- [Operations](../architecture/operations.en.md)
