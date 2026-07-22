---
type: layered-translation
source: roadmap.md
lang: en
sourceFileCrc: 83bdf7fe
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Implementation Roadmap

> Product document: **in what order** the [target architecture 0.3.0-draft](architecture/index.md) is built and what constitutes the readiness of each step. The architecture says "what and how," the roadmap says "what first." Strategic framework — [vision.md](vision.en.md): core + one surface, proven by dogfooding.

## Essence

This document outlines the phased plan for building the target architecture, clearly defining the sequence of implementing key functional blocks from the core to interactive interfaces. Each stage is tied to a specific demo criterion, ensuring functional confirmation at the MVP stage. The goal is to build a resilient, autonomous system that gradually unlocks agent control capabilities from any device.

Each milestone has a **demo criterion** — a scenario that can be demonstrated in one minute. A milestone is not "ready by 80%": the demo is either reproducible or it is not.

## M0 — Core Dogfood (`@7n/mt` 0.2.x → strengthening)

MT itself is developed through MT: the tasks of this repository are nodes in the `mt/` graph, and agents execute them autonomously based on the 0.2.x contract.

- **Demo Criterion:** a real feature of this repo went through a full cycle of `init → plan → spawn → run → audit → resolved` without manual git operations; `mt status` shows the live graph.
- Covers DoD scenario 1 (autonomous headless).
- Output: a list of contract frictions — input data for M1 priorities.

## M1 — agent-server locally (`mt serve` + `mt attach`)

The first Rust layer: `agent-protocol` + `agent-core` + minimal `agent-server` (one machine, local WS, no relay). The interactive session = running the node: log in run ref, push every move.

- **Demo Criterion:** `mt attach <node>` opens a chat with the task; if you close the laptop — open it — the session resumes with replay; `mt done` publishes a fact to main using the same fenced publish.
- Event protocol v4 (including `lang` in ClientHello — the field is there, translation is not yet).

## M2 — Mission control (relay + phone-approver)

Relay (accounts, membership, presence, push) + mobile thin client. This is the product from vision.md: "agents on all your devices under control from your pocket."

- **Demo Criterion:** task of account A is performed on the server; participant B's phone (approver role, no git access) receives a push, shows the diff of the destructive action, B signs — the signature is visible in `run_NNN.md ## Approvals`. Session migration "move here" between two machines works.
- Covers DoD scenarios 2, 3, 5.

## M3 — Dashboard and Surfaces

`mt-dashboard` (subgraph as one picture) + the first specialized surface according to [surfaces.md](architecture/surfaces.en.md) (reference — designer with preview).

- **Demo Criterion:** the dashboard shows the live states of the entire subtree (NodeState/PlanReview/Committed); in the designer session, the user clicks an element in the preview → `ContextSelected` → the agent edits only that one. Approving the plan from the dashboard.
- Covers DoD scenario 4.

## M4 — i18n File Layer

Implementation of [i18n.md](architecture/i18n.en.md): worktree materialization, contract-aware compilation in base, `refs/mt/i18n/*`, system regeneration queue, live translation by capability.

- **Demo Criterion** (which is also the readiness criterion for the i18n chapter): participant A (uk) and participant B (de) edit one README each in their language; in `main` — only the English base; author's text A is not corrupted by reverse translation; a third language appears lazily upon first opening.

## M5 — Meta-cycle (retro)

Implementation of [retro.md](architecture/retro.en.md): background analysis of the audit trail, private proposals to the executor, application via standard config edits; innovations with baseline and impact measurement.

- **Demo Criterion (proposals):** after $\geq$ `retro.min_resolved` resolved tasks, `mt retro` provides at least one proposal with `evidence` links to specific run files; accepting the proposal generates a specific edit to `a.md`/config for review.
- **Demo Criterion (impact):** an accepted innovation (`innovation_NNN.md` with baseline) through $\geq$ `retro.impact_min_runs` runs in scope receives an impact slice with measured $\Delta wall/\Delta cost/\Delta failed\_streak$ — the author's contribution is visible with evidence.
- **MVP does not wait for M1–M4:** the analysis works on local data immediately after M0 (dogfood) — without relay and sessions; only delivery to devices is added in M2+.

## Beyond the roadmap (intentionally)

- Hosted relay as a service (billing, tenants) — after the first external user self-hosted.
- Moving the graph contract to Rust — separate ADR after protocol stabilization ([stack.md](architecture/stack.en.md)).
- Quorum cryptographic succession protocols — 0.3.0 uses co-owner practice ([access.md](architecture/access.en.md)).
