---
type: ADR
title: Sentinel-файл .ncursor-signal для комунікації агент-wrapper
description: Агент передає wrapper-у результат запуску через файловий sentinel `.ncursor-signal`, а не через exit codes.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

У режимі `mt run` wrapper-процес запускає agent CLI в ізольованому worktree. Агент має повідомити, що робити після завершення процесу: зафіксувати успіх, провал, запит аудиту або декомпозицію в підзадачі. Wrapper повинен прочитати цей сигнал після `exit`, не покладаючись на внутрішні деталі агента.

## Considered Options

- Sentinel-файл: команди `mt done`, `mt failed`, `mt spawn`, `mt audit` пишуть `.ncursor-signal` у директорію вузла перед `exit`; wrapper читає файл після завершення процесу.
- Exit codes: різні exit codes для різних сигналів.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Sentinel-файл `.ncursor-signal`", because файловий підхід узгоджується з файловою моделлю стану DAG; wrapper читає сигнал асинхронно після завершення процесу; агент не залежить від реалізації wrapper-у.

### Consequences

- Good, because transcript фіксує очікувану користь: `signals.mjs` реалізує чотири команди через єдиний файловий механізм.
- Bad, because transcript не містить підтвердження негативних наслідків.
- Neutral, because реалізація була відкочена після сесії, але саме рішення про файловий сигнал зафіксоване як частина обговорення.

## More Information

- Реалізація з transcript: `npm/scripts/graph/signals.mjs`.
- Формат файлу: `type: done|audit|failed|spawn`.
- `run.mjs` читає файл після завершення процесу, видаляє sentinel і виконує відповідну дію: merge, spawn auditor або write run record.
- Відкочені зміни в цій сесії: `npm/bin/n-cursor.js`, `npm/scripts/graph/`, `.changes/260606-2107.md`.
