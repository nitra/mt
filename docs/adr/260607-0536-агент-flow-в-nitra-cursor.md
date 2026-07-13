---
type: ADR
title: Агент flow у @nitra/cursor
description: До реєстру агентів @nitra/cursor додається тип `flow`, який оркеструє flow-команди через API `mt plan`, `mt verify` і `mt run`.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Пакет `@nitra/cursor` мав фіксований набір агентів: `adr`, `coverage`, `docgen`, `fix`, `lint`, `taze`. Потрібно додати новий тип агента `flow`, який ходить по агентам через API та використовує команди `mt plan`, `mt verify`, `mt run <name> <input>`. Задача має бути описана у типах і сутностях агентів.

## Considered Options

- Додати `flow` як повноцінний агент: новий `FlowAgent`, розширення `AgentId`, типи `FlowPlan` / `FlowVerify` / `FlowStep`, запис у `AGENTS`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `flow` як повноцінний агент", because користувач явно описав новий тип агента `flow`, який працює через API `mt plan`, `mt verify` і `mt run <name> <input>` та має бути представлений у типах і сутностях агентів.

### Consequences

- Good, because `flow` стає першокласним значенням `AgentId` і потрапляє до реєстру `AGENTS` разом з іншими агентами.
- Good, because API `mt plan` і `mt verify` повертають structured output для типобезпечного flow-протоколу.
- Bad, because transcript фіксує, що на момент обговорення `npm/src/cli/flow/plan.ts`, `verify.ts` і `run.ts` були TODO-заглушками; повна реалізація команд потребує окремої роботи.

## More Information

Файли, яких стосується рішення:

- `npm/src/types.ts` — розширити `AgentId` значенням `'flow'`; додати або експортувати типи flow API.
- `npm/src/agents/flow.ts` — новий клас `FlowAgent implements Agent`.
- `npm/src/agents.ts` — додати `export { FlowAgent }` і запис `flow` у `AGENTS`.
- `npm/src/cli/flow/plan.ts` — API `mt plan`, повертає `StructuredOutput` з plan.
- `npm/src/cli/flow/verify.ts` — API `mt verify`, повертає `StructuredOutput` з verify.
- `npm/src/cli/flow/run.ts` — API `mt run <name> <input>`, де `<input>` є JSON-рядком.

Під час сесії також створено changeset `.changesets/1749296099946-npm.md` з `bump: major` для workspace `npm`.
