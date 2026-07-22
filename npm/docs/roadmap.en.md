---
type: layered-translation
source: roadmap.md
lang: en
sourceFileCrc: c51291a6
authored: false
translated: 2026-07-22
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Implementation Roadmap

> Product document: **in what order** [target architecture 0.3.0-draft](architecture/index.md) is built and what constitutes completion for each step. The architecture says "what and how," the roadmap says "what first." The strategic framework is [vision.md](vision.en.md): core + one surface, validated by dogfooding.

## Core Idea

This document outlines the phased plan for building the target architecture, clearly defining the sequence of realizing key functional blocks from the core to the interactive interfaces. Each stage is tied to a specific demo criterion, ensuring functionality verification at the MVP stage. The goal is to build a stable, autonomous system that gradually unlocks the possibility of controlling agents from any device.

Each milestone has a **demo criterion**—a scenario that can be shown in one minute. A milestone is not "80% ready": the demo either works or it doesn't.

## M0 — Core Dogfooding (`@7n/mt` 0.2.x $\to$ strengthening)

The development of MT itself is done through MT: the tasks of this repository are nodes in the `mt/` graph, and agents execute them autonomously according to the 0.2.x contract.

- **Demo Criterion:** a real feature of this repo has gone through the full cycle of `init $\to$ plan $\to$ spawn $\to$ run $\to$ audit $\to$ resolved` without manual git operations; `mt status` shows a live graph.
- Covers DoD scenario 1 (autonomous headless).
- Output: a list of contract friction points $\to$ input data for M1 priorities.

## M1 — agent-server locally (`mt serve` + `mt attach`)

The first Rust layer: `agent-protocol` + `agent-core` + minimal `agent-server` (one machine, local WS, no relay). Interactive session = running the node: log in the run ref, push each move.

- **Demo Criterion:** `mt attach <node>` opens a chat with a task; closed the laptop $\to$ opened it $\to$ the session resumed with replay; `mt done` publishes a fact in main with the same fenced publish.
- Event protocol v4 (including `lang` in ClientHello—field exists, translation not yet).

## M2 — Mission control (relay + phone-approver)

Relay (accounts, membership, presence, push) + mobile thin client. This is the product from vision.md: "agents on all your devices under control from your pocket."

- **Demo Criterion:** account A's task is executed on the server; participant B's phone (approver role, without git access) receives a push, shows the diff of the destructive action, B signs $\to$ the signature is visible in `run_NNN.md ## Approvals`. Session migration "move here" between two machines works.
- Covers DoD scenarios 2, 3, 5.

## M3 — Dashboard and surfaces

`mt-dashboard` (subgraph as one picture) + the first specialized surface according to [surfaces.md](architecture/surfaces.en.md) (reference $\to$ designer with preview).

- **Demo Criterion:** the dashboard shows live states of the entire subgraph (NodeState/PlanReview/Committed); in the designer session, the user taps an element in the preview $\to$ `ContextSelected` $\to$ the agent fixes exactly that one. Approving a plan from the dashboard.
- Covers DoD scenario 4.

## M4 — i18n File Layer

Implementation of [i18n.md](architecture/i18n.en.md): worktree materialization, contract-aware compilation to base, `refs/mt/i18n/*`, systemic regeneration queue, live translation by capability.

- **Demo Criterion** (same as the readiness criterion for the i18n chapter): participant A (uk) and participant B (de) edit one README each in their language; in `main` $\to$ only the English base; author A's text is not spoiled by reverse translation; the third language appears lazily upon first opening.

## M5 — Meta-cycle (retro)

Implementation of [retro.md](architecture/retro.en.md): background analysis of the audit trail, private proposals to the executor, application via standard config edits; innovations with baseline and impact measurement.

- **Demo Criterion (proposals):** after ≥ `retro.min_resolved` resolved tasks, `mt retro` outputs at least one proposal with `evidence`-links to specific run files; accepting the proposal generates a specific edit `a.md`/config for review.
- **Demo Criterion (impact):** an accepted innovation (`innovation_NNN.md` with baseline) through ≥ `retro.impact_min_runs` runs in the scope receives an impact slice with measured $\Delta$wall/$\Delta$cost/$\Delta$failed_streak $\to$ the author's contribution is visible with proofs.
- **MVP does not wait for M1–M4:** analysis works on local data immediately after M0 (dogfood) $\to$ without relay and sessions; on M2+ only device delivery is added.

## M6 — Mandates and Human-Centric Escalation

Implementation of [mandates.md](architecture/mandates.md) deployment to a real structure ($\sim$20 people: two owners of core mandates, managers, engineers). The axis of deployment is **task classes, not people**; "100% of collective tasks via MT" $\to$ milestone completion criterion, not a starting decree (big-bang process-tool on a team that didn't ask for it $\to$ classic adoption failure). **Parallel track from day one $\to$ model cascade** (least-capable-sufficient by node, `Haiku $\to$ Sonnet $\to$ Fable/Opus $\to$ human`): immediate direct token savings and testing of selector/decision-request/precedents without social risks $\to$ by the time humans of medium level enter, the machinery is already bombarded by models.

- **Phase 0** (after M0, CLI is sufficient): founders + 2–3 volunteer engineers, dev tasks. Minimal `mandates.yaml` + CI check of delegator signature; `decision-request` with `leverage_facets` + `chosen_option` in `ApprovalResponse`; invariant retry-before-escalate; process watcher (stuck claims, SLA of decision-requests). **Demo Criterion:** the run exhausts the retry ladder on the developer (not a bug) $\to$ the node is in the state `awaiting-decision` with a wrapped `decision-request` in the calculated owner $\to$ instead of a random "unresolvable" alert; a signed `ApprovalResponse` with `chosen_option` is visible in git log.
- **Phase 1** (requires [M3](#m3--dashboard-і-поверхні)-dashboard $\to$ non-developers do not touch git/CLI): managers as mandate owners $\to$ their mandates are written **first** (new identity: owners of decision scopes and node results, not information relays $\to$ otherwise they become a point of resistance). Modes decide-and-inform (`auto-approved-by-policy`, reversible invariant) and `delegate_down`; precedent engine. Before the phase, the community is published a trust agreement: "what the system sees and what it never does" (negative evaluations do not exist anywhere, watcher pings first the executor, probe transparency).
- **Phase 2** (after accumulating history): selector least-qualified-capable + org-repo of profiles (positive-only confirmation dossiers, writes only an aggregator, dispute via mandate owner signature) + `stretch`/`probe`; escalation analyzer (both directions); competency aggregator as the second output of the retro engine.
- **Completion Criterion:** 100% of collective tasks go through the MT process; the criterion in [vision.md](vision.en.md) is measured $\to$ readiness to use without coercion.

## Outside the roadmap (consciously)

- Hosted relay as a service (billing, tenants) $\to$ after the first external user self-hosted.
- Moving the graph contract to Rust $\to$ separate ADR after protocol stabilization ([stack.md](architecture/stack.en.md)).
- Quorum cryptographic protocols of succession $\to$ 0.3.0 relies on co-owner practice ([access.md](architecture/access.en.md)).
