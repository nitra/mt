---
type: layered-translation
source: overview/core.md
lang: en
sourceFileCrc: 8327f928
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Core: Task Graph and Coordination via Git

## Essence

The system is based on Git as the single source of truth to ensure reliability and a transparent audit trail. The architecture separates responsibilities between layers, where Git provides persistent storage, and Relay provides ephemeral coordination. The core implements a recursive task graph with dynamic scheduling, utilizing mechanisms for atomic management of task lifecycles.

## Merge Solution and System Layers

The architectural description defines the general structure of the system, where Git serves as the primary source of truth. The system uses cryptographic signatures to guarantee reliability, reducing complex operations to atomic transactions. This ensures high resilience and a transparent audit trail for all decisions.

## Core: Recursive Task Graph

This document describes the architectural model of a recursive task graph with dynamic scheduling. It defines a clear contract for nodes (atomic or composite), ensuring encapsulation. A multi-level state system manages the task lifecycle, guaranteeing a transparent and atomic data flow.

## Coordination via Git

Coordination mechanisms between AI agents ensure task atomicity and integrity through the concept of "authoritative claims." The system tracks state through "run refs" and ensures reliable workload handover between hosts using "checkpoint-handoff." All results are published through a protected "fenced publish" process to the `main` branch.

## Deeper Dive

- [Overview: Merge Solution and System Layers](../architecture/overview.en.md)
- [Core: Recursive Task Graph](../architecture/graph.en.md)
- [Coordination via Git](../architecture/git.en.md)
