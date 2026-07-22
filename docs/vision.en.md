---
type: layered-translation
source: vision.md
lang: en
sourceFileCrc: ba4ec220
authored: false
translated: 2026-07-22
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Goal: Task platform for people and AI

> Normative document «why». Architecture ([architecture/](architecture/index.md)) is «how»; every architectural decision must support this goal.

## Essence

This platform implements delegation inversion, shifting the focus of management from task assignment to defining the ultimate goal and values. The AI orchestrator automatically decomposes this goal, utilizing interchangeable executors—humans and agents. The human remains the source of strategic mandate and control at critical system "gates." The platform ensures cross-linguistic capability and self-improvement through retrospective analysis, making the human the owner of decisions, not just the dispatcher.

## Thesis: Delegation Inversion

Many excellent products have been created for project management—from Trello to Jira. They were all designed in a world where tasks were assigned by people and executed by people; agent enhancements (Linear agents, GitHub Agent HQ) merely added AI assistants **inside the human process**.

MT is built for the opposite world: **the founder defines the goal and values — the AI achieves them**. The AI orchestrator decomposes the goal into a self-modifying task graph, launches AI executors, evaluates results, and reconstructs the graph. The human in this process is not a task dispatcher, but:

1. **Source of the goal.** The human defines the «why», constraints, and priorities; the orchestrator does not redefine them. In terms of [mandates.md](architecture/mandates.md), this is the root mandate.
2. **Gate signatory.** Critical transitions (destructive actions, plan, audit) require the cryptographic signature of a human—control shifts from task assignment to gates.
3. **Owner of decisions and assigned executor.** Where the AI itself recognizes the need for a human (branching outside the model cascade thresholds, qualification, physical action), it escalates the packaged branch to the mandate owner or **assigns a human of the appropriate qualification**—with the same node contract as for the agent ([mandates.md](architecture/mandates.md)).

The interchangeability of human and agent at a node (the same lifecycle, budgets, audit) is not a goal, but a **prerequisite** for inversion: for the orchestrator to be able to assign anyone, the contract must be common.

Git/GitHub is primarily a developers' tool. For the new world, it remains a **substrate** (reliability, offline, audit trail, absence of lock-in), but not the interface: the convenience of human and machine operation must be above it.

## Five Cross-Dimensions

Delegation inversion requires five cross-properties of the platform:

1. **Cross-executional.** Human and agent are interchangeable executors of one task node; the same lifecycle, budgets, audit, escalation.
2. **Cross-device.** Mac / server / phone are equal points of participation: execution where resources exist; control and approval—from any device, including without git access.
3. **Cross-programming.** Not one universal Codex/Claude, but **specialized tools** (designer, writer, cli, …) that operate within a specific task/process—via surface profiles, skills, and providers on the node.
4. **Cross-human.** Multiple people in one task: membership, roles, invitations, multi-party signed approvals.
5. **Cross-linguistic.** Previously, everything was converted to English—uncomfortable for non-native speakers, but multilingualism was "expensive." Now AI makes the content multilingual automatically: canonical content is in the author's language, the surface renders it in each participant's language. This fosters cross-national interaction.

## Niche: What these are not

- **Jira / Trello / Asana** — trackers for human executors: the card describes the work but is not a contract that a machine can execute. In MT, `task.md` + `## Done when` + `## Check` — is a machine-executable contract, common to human and agent.
- **Linear (agents), GitHub Agent HQ** — agents as assistants inside a third-party vendor-hosted product, tied to its domain (software development) and its cloud: AI contribution inside the human process. MT is the opposite, **human contribution inside the agent process**; local-first and vendor-neutral: state in your git, any models (local or cloud), the task domain is not limited by code.
- **LangGraph / CrewAI / AutoGen** — orchestration libraries for developers: agent graphs in code, without humans as equal executors, without a surface product. MT is a platform where the graph lives in files, the human is a full node, and control (approvals, audit) is built-in and cryptographic.
- Common trait that none of them have: **cross-linguistic capability as a platform property** — every participant works in their own language on one canon.

## Human as Owner, Not Exception-Handler

The cost of human coordination can be removed in two ways. The first—the human receives a dense stream of others' unresolved problems without context (everything the AI didn't handle); the better the automaton works, the worse she is prepared for the moment it fails. MT consciously builds the second: **fractal ownership**—at every level, from the node executor to the task owner, the human owns the "what and why" of their horizon (mandate), and the system handles the "how" and information transport between levels. The human does not receive "it broke"—they receive a branch of their level: context, options, cost of delay, agent recommendation (`decision-request`); the system must handle everything else (retry-before-escalate). Authority (mandate) does not automatically follow skill (competence)—otherwise, the best engineer becomes a manager involuntarily; the mandate expands only by a conscious signed act of delegation. The mechanism is [mandates.md](architecture/mandates.md).

## Meta-Cycle: Retrospective Self-Improvement

It is difficult for people (and agents) to systematically improve their own process: retrospective requires separate effort, so it is rarely done. The platform has this data for free—the graph's audit trail records who, what, and by what was decided. Therefore, a separate goal: AI retrospectively analyzes completed tasks, seeks better solutions/skills/tools, and offers the executor: "you solved task X via Y; Z1 or Z2 would have been faster/better." This closes the cross-programming dimension: the selection of tools for a node is fueled by data, not just static configuration.

Trust principle: the cycle works **for the executor**—proposals are addressed to them personally, opt-in; this is not a surveillance tool for management.

## Mapping to Architecture 0.3.0-draft

| Dimension | Where is it anchored |
| --- | --- |
| Cross-executional | [graph.md](architecture/graph.en.md): `a.md`/`h.md`, retry ladder → engineer → human, audit |
| Cross-device | [runtime.md](architecture/runtime.en.md): agent-server, session migration; [access.md](architecture/access.en.md): approver without git access |
| Cross-programming | [surfaces.md](architecture/surfaces.en.md): surface profiles, MCP tools, connection to sandbox |
| Cross-human | [access.md](architecture/access.en.md): membership, roles, Ed25519 signatures on three gates |
| Cross-linguistic | [i18n.md](architecture/i18n.en.md): base canon, derived translations in `refs/mt/i18n`, worktree materialization |
| Meta-cycle self-improvement | [retro.md](architecture/retro.en.md): audit trail analysis, private opt-in proposals to the executor, application of standard fixes |
| Human as owner of decisions | [mandates.md](architecture/mandates.md): mandate map, `decision-request`, leverage routing, precedent engine |
| Delegation inversion | [graph.md](architecture/graph.en.md): decomposition, retry ladder; [mandates.md](architecture/mandates.md): escalation-assignment, executor selector |

## Implications for Focus

- Priority — the graph core + one surface, proven by **dogfooding**: MT development is done through MT. The order of steps is [roadmap.md](roadmap.en.md).
- The first product — **autonomous goal achievement with a human at the gates**; mission control (mac + server + phone-approver) is its component, not a separate product. The scale of "replacing Jira" (teams, cross-linguistic) is the next ring.
- Git remains Layer 0 (truth), but no scenario for a non-developer must require working with git directly.
