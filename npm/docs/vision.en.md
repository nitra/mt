---
type: layered-translation
source: vision.md
lang: en
sourceFileCrc: 015cbbd5
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Goal: Task platform for people and AI

> The normative document "why". The architecture ([architecture/](architecture/index.md)) is "how"; every architectural decision must support this goal.

## Essence

This platform creates a new approach to project management by treating artificial intelligence as an equal executor alongside humans. It provides a universal task contract that can be executed by either a human or an agent, regardless of device or language. System audit and multilingual support are built into the core, allowing processes to be automatically trained and optimized based on executed actions. This ensures a reliable, vendor-neutral, and multi-vector working ecosystem.

## Thesis

Many wonderful products have been created for project/task management—from Trello to Jira. But they were all designed in a world where **only humans were the executors**.

Now AI is becoming an **independent entity** that solves a number of tasks—and some much better than humans. Therefore, a platform is needed where projects and tasks are worked on not just by humans, but predominantly by AI—**as equal executors, with the same task contract**.

Git/GitHub is primarily a tool specialized for developers. For the new world, it remains a **substrate** (reliability, offline, audit trail, absence of lock-in), but not an interface: the convenience of work for humans and machines must be above it.

## Five Cross-Dimensions

1. **Cross-Executor.** Human and agent are interchangeable executors of a single task node; the same lifecycle, budgets, audit, escalation.
2. **Cross-Device.** Mac / server / phone—equal points of participation: execution where resources are available; control and approval—from any device, even without git access.
3. **Cross-Programming.** Not one universal Codex/Claude, but **specialized tools** (designer, writer, cli, …) that operate within the framework of a specific task/process—via surface profiles, skills, and providers on the node.
4. **Cross-Human.** Multiple people in one task: membership, roles, invitations, multi-party signed approvals.
5. **Cross-Language.** Previously, everything was reduced to English—inconvenient for non-native speakers, but multilingualism was "expensive." Now AI makes content multilingual automatically: canonical content is in the author's language, the surface renders it in the participant's language. This fosters cross-national interaction.

## Niche: What it is not

- **Jira / Trello / Asana** — trackers for human executors: a card describes the work but is not a contract that a machine can execute. In MT, `task.md` + `## Done when` + `## Check` is a machine-executable contract, common to both human and agent.
- **Linear (agents), GitHub Agent HQ** — agents as assistants inside another vendor-hosted product, tied to its domain (software development) and its cloud. MT is local-first and vendor-neutral: state in your git, any models (local or cloud), the task domain is not limited by code.
- **LangGraph / CrewAI / AutoGen** — orchestration libraries for developers: agent graphs in code, without humans as equal executors, without a surface product. MT is a platform where the graph lives in files, the human is a full-fledged node, and control (approvals, audit) is built-in and cryptographic.
- The common thread that none of them have: **multilinguality as a platform feature**—every participant works in their language on one canon.

## Meta-Cycle: Retrospective Self-Improvement

It is difficult for humans (and agents) to systematically improve their own process: retrospectives require separate effort, so they are rarely done. The platform has this data for free—the graph's audit trail records who, what, and how it was decided. Therefore, a separate meta-goal: AI retrospectively analyzes executed tasks, looks for better solutions/skills/tools, and suggests to the executor: "Task X was solved by you using Y; Z1 or Z2 would have been faster/better." This closes the cross-programming dimension: the choice of tools for a node is fueled by data, not just static configuration.

Trust principle: the cycle works **for the executor**—suggestions are addressed to them personally, opt-in; this is not a tool for management oversight.

## Mapping to Architecture 0.3.0-draft

| Dimension | Where is it implemented |
| --- | --- |
| Cross-Executor | [graph.md](architecture/graph.en.md): `a.md`/`h.md`, retry ladder → engineer → human, audit |
| Cross-Device | [runtime.md](architecture/runtime.en.md): agent-server, session migration; [access.md](architecture/access.en.md): approver without git access |
| Cross-Programming | [surfaces.md](architecture/surfaces.en.md): surface-profiles, MCP-tools, linkage to sandbox |
| Cross-Human | [access.md](architecture/access.en.md): membership, roles, Ed25519 signatures on three gates |
| Cross-Language | [i18n.md](architecture/i18n.en.md): base-canon, derived-translations in `refs/mt/i18n`, worktree materialization |
| Meta-Cycle Self-Improvement | [retro.md](architecture/retro.en.md): audit trail analysis, private opt-in suggestions to the executor, application of standard fixes |

## Implications for Focus

- Priority is the graph core + one surface, proven by **dogfooding**: MT is developed using MT. The order of steps is in [roadmap.md](roadmap.en.md).
- The first product is the "mission control for agents on all devices" (Mac + server + phone-approver); the scale of "replacing Jira" (teams, cross-language) is the next loop.
- Git remains Layer 0 (truth), but no scenario for a non-developer should require working with git directly.
