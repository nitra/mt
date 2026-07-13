---
type: ADR
title: mt watch як pull-модель сигналізації людині
description: Людські втручання в task graph виявляються окремою командою `mt watch`, яка сканує файловий стан замість push-нотифікацій.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Система має повідомляти людину, коли вузол потребує втручання: вичерпаний бюджет на кореневому рівні, три поспіль failed-аудити або завислий worktree. Потрібно визначити, чи це робиться push-повідомленнями через окремий `graph notify`, чи окремим pull-сканером.

## Considered Options

- `graph notify` — push-повідомлення через stdout і `notify_cmd` у конфігу.
- `mt watch` — pull-сканування графа для пошуку проблемних вузлів.

## Decision Outcome

Chosen option: "mt watch", because pull-підхід простіший: людина або система запускає `watch`, скрипт сканує граф і репортить проблеми без зовнішньої інфраструктури для push.

### Consequences

- Good, because transcript фіксує очікувану користь: `mt watch` може запускатися після merge поруч із `mt run --auto` і як watchdog для stale worktree.
- Bad, because transcript не містить підтвердження негативних наслідків.
- Neutral, because пороги й конкретні умови репортування беруться з файлового стану та конфігу, а не з daemon-процесу.

## More Information

- `mt watch` репортить ≥ 3 поспіль `actor: auditor, result: failed`.
- `mt watch` репортить `actor: engineer, result: failed` на кореневому рівні.
- `mt watch` репортить stale worktree, якщо немає змін довше `stale_worktree_min` хвилин.
- Конфіг: `stale_worktree_min`.
- Файл з transcript facts: `npm/docs/mt.md`, секція `## mt watch`.
