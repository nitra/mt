---
type: ADR
title: Окремий модуль npm/scripts/graph для нового task orchestration
description: Новий autonomous task DAG реалізується в окремому `npm/scripts/graph/`, щоб не ламати legacy `dispatcher/graph.mjs`.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Існуючий `npm/scripts/dispatcher/graph.mjs` є read-only прототипом, що сканує `docs/graphs/<g>/nodes/*.md` і деривує статус з artifact-файлів `plan`, `claim`, `fact`, `ask`, `ans`. Документ `npm/docs/mt.md` описує іншу архітектуру: рекурсивний task DAG на основі `tasks/<node>/task.md`, autonomous execution агентами, worktree-ізоляцію та lifecycle через сигнальні файли. Потрібно вирішити, чи розширювати legacy-реалізацію, чи створити ізольований модуль.

## Considered Options

- Розширити існуючий `dispatcher/graph.mjs` з backward-compat шаром для нового формату.
- Створити окремий модуль `npm/scripts/graph/` і залишити старий `dispatcher/graph.mjs` незайманим.

## Decision Outcome

Chosen option: "Створити окремий модуль `npm/scripts/graph/`", because архітектури несумісні на рівні file layout і state machine: старий формат читає `docs/graphs/` з artifact-типами, новий — `tasks/` з sentinel-файлами; заміна зламала б існуючі тести `dispatcher/tests/graph.test.mjs` без практичної користі.

### Consequences

- Good, because transcript фіксує, що старі 42 тести `dispatcher/tests/` залишились зеленими.
- Good, because нова система отримала ізольований простір для нових тестів `graph/tests/state.test.mjs`.
- Bad, because `mt` тимчасово має дві реалізації під різними route-ами, що може плутати до видалення legacy `dispatcher/graph.mjs`.

## More Information

- Нові файли з transcript: `npm/scripts/graph/config.mjs`, `state.mjs`, `scan.mjs`, `setup.mjs`, `init.mjs`, `invalidate.mjs`, `signals.mjs`, `run.mjs`, `kill.mjs`, `watch.mjs`, `index.mjs`, `tests/state.test.mjs`.
- CLI routing: `npm/bin/n-cursor.js`, `case 'graph'` імпортує `../scripts/graph/index.mjs`.
- Додано `case 'watch'` → `../scripts/graph/watch.mjs`.
- State-machine facts: `deriveState(nodeDir, worktrees)`, `sanitizePathToWorktreePrefix(rel)`, `findLatestFile(dir, prefix)`, `nextFilename(dir, prefix, ext)`.
- Сигнальні команди агента: `mt done <path>`, `mt audit <path>`, `mt failed <path>`, `mt spawn <path>` пишуть `.signal` у директорію вузла.
