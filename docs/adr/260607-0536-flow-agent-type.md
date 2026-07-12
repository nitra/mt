---
type: ADR
title: Введення типу агента flow у @nitra/cursor
description: До реєстру агентів додається новий тип flow, який використовує CLI API mt plan, mt verify і mt run.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Пакет `@nitra/cursor` має фіксований набір типів агентів: `adr`, `coverage`, `docgen`, `fix`, `lint`, `taze`. Потрібно додати новий тип агента `flow`, який ходить по агентам через API і працює з командами `mt plan`, `mt verify` та `mt run <name> <input>`. Задача має бути описана у TypeScript-типах і сутностях агентів.

## Considered Options

- Додати `flow` як повноцінний агент: розширити `AgentId`, створити `FlowAgent`, додати export і запис у `AGENTS`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `flow` як повноцінний агент", because користувач прямо описав новий тип агента `flow`, який використовує API `mt plan`, `mt verify` і `mt run <name> <input>`, а існуюча кодова база вже має патерн агентів через `AgentId`, `Agent` і `runCli()`.

### Consequences

- Good, because `flow` стає першокласним значенням у типах і реєстрі `AGENTS` поруч з іншими агентами.
- Good, because реалізація може повторити наявний патерн `AdrAgent`, `CoverageAgent`, `DocgenAgent`, `FixAgent`, `LintAgent`, `TazeAgent`.
- Neutral, because transcript фіксує, що `npm/src/cli/flow/plan.ts`, `verify.ts` і `run.ts` на момент аналізу містять TODO-заглушки.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файли, зафіксовані в transcript як релевантні:

- `npm/src/types.ts` — розширити `AgentId` значенням `'flow'`; за потреби додати `StructuredOutput`, `FlowPlan`, `FlowVerify`, `FlowStep`.
- `npm/src/agents/flow.ts` — новий файл з `FlowAgent implements Agent`.
- `npm/src/agents.ts` — додати `export { FlowAgent }` і запис `flow` у `AGENTS`.
- `npm/src/common.ts` — містить helper `runCli(command, input)` через `spawnSync('n-cursor', ...)`.
- `npm/src/cli/flow/plan.ts` — API `mt plan`, повертає `StructuredOutput` з plan.
- `npm/src/cli/flow/verify.ts` — API `mt verify`, повертає `StructuredOutput` з verify.
- `npm/src/cli/flow/run.ts` — API `mt run <name> <input>`, де `<input>` є JSON-рядком.

Для major bump створено changeset `.changesets/1749296099946-npm.md` з `bump: major` для workspace `npm`; версію вручну не змінювати.
