---
type: layered-translation
source: overview/index.md
lang: en
sourceFileCrc: 165e2ee3
authored: false
translated: 2026-07-22
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# How it works

## Core Concept

The platform gives the human strategic control over the goal, and the system automates the execution.
Git ensures reliability and transparency as the single source of truth.
Execution is coordinated through the `agent-server`, sessions, events, and specialized surfaces.
The system supports user control, multilingualism, support, and self-improvement through retrospective analysis.

## Strategic Management

The human defines the goal and maintains control through critical system gates.
The platform takes over execution management and supports self-improvement through retrospective analysis.
The focus is on transparency, user control, and architectural resilience.

## System Core

Git is used as the single source of truth for persistent storage, reliability, and audit trail.
Relay is responsible for ephemeral coordination.
The core implements a recursive task graph with dynamic scheduling and atomic task lifecycle management.

## Execution

A centralized `agent-server` orchestrates interactive sessions via the `Envelope` event protocol.
The system supports different operating modes and session migration between hosts.
Surfaces configure the context and tools for a specific task.

## Technological and Operational Foundation

Nitra MT has a standardized technology stack: business logic is encapsulated in `@7n/mt` on Bun/JS, and the host is implemented in Rust.
The overview also covers participant and device interaction, multilingual mechanisms, the self-improvement cycle, and operational contracts.

## Deeper Dive

- [Goal and Path](direction.en.md)
- [Core: Task Graph and Coordination via git](core.en.md)
- [Runtime: Hosts, Sessions, Surfaces](runtime.en.md)
- [People, Access, Support](people.en.md)
