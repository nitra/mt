---
type: ADR
title: Рефакторинг mt flow в уніфікований mt graph
description: CLI flow namespace видаляється, а виконання task-графу централізується в graph-протоколі з файловими артефактами вузлів.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

У системі існували паралельні механізми: попередній `flow` workflow із командами на кшталт `init`, `plan`, `verify`, `audit`, `done` та новий DAG-оркестратор із `tasks/<node>/task.md`, `plan_NNN.md`, `outputs_NNN.md`, `pending-audit_NNN.md`. Це створювало дублювання namespace, команд і моделей стану. Transcript фіксує потребу перейти до єдиного файлового протоколу виконання вузла.

## Considered Options

- Зберегти `flow` як окремий namespace і інтегрувати його з `graph` через зовнішній контракт.
- Повністю видалити `flow`, перенести всі функції під `graph` і залишити єдиний CLI entry point.
- Для `mt plan`: залишити окремі кроки spec/decompose або об'єднати їх в один крок.
- Для аудиту: залишити синхронний `verify` або замінити його async чергою.
- Для orchestrator race: дозволити `mt run --auto` і `mt watch` запускати вузли паралельно або зробити `mt watch` єдиним оркестратором.
- Для composite вузлів: робити roll-up run, автоматично писати parent outputs або деривувати стан із дітей.

## Decision Outcome

Chosen option: "Повністю видалити `flow` і централізувати graph-протокол під `mt`", because transcript фіксує, що `flow` namespace став надлишковим: `mt plan` поглинає spec+decompose, `verify` замінюється async аудитом, а запуск, аудит, merge і cleanup мають керуватися єдиним `mt watch` та файловими артефактами task-графу.

### Consequences

- Good, because є один CLI entry point і одна модель стану на основі `tasks/<node>/task.md` та immutable markdown-файлів вузла.
- Good, because `mt watch` як єдиний оркестратор усуває race condition між daemon та one-shot runner; post-merge hook лише будить daemon через trigger file.
- Good, because async аудит відокремлює виконавця від аудитора: агент пише `outputs_NNN.md`, створює `pending-audit_NNN.md`, аудитор пише `audit-result_NNN.md`.
- Good, because composite вузол може бути resolved через bottom-up агрегацію дітей без додаткового roll-up запуску.
- Bad, because transcript фіксує breaking change: `flow` команди й залежні dispatcher-модулі треба видалити або перенести.
- Neutral, because transcript не містить підтвердження негативних наслідків для користувачів поза потребою міграції команд і файлів.

## More Information

Фінальний протокол із transcript:

- `mt plan` поєднує попередні spec і decompose: для atomic вузла пише `plan_001.md`, для composite створює дочірні `task.md` і агент явно викликає spawn.
- Stage 2: агент виконує роботу, пише `outputs_NNN.md`, далі викликає `mt done`, `mt audit` або `mt failed`.
- `pending-audit_NNN.md` має той самий `NNN`, що й відповідний `outputs_NNN.md`.
- `audit-result_NNN.md` має той самий `NNN`, що й `pending-audit_NNN.md`; наявність result-файлу означає, що аудит оброблено.
- `mt watch` є єдиним оркестратором: сканує граф, запускає ready-вузли, dispatches auditor, merge-ить після успішного аудиту та виконує Telegram-ескалації.
- Post-merge hook лише створює wake/trigger file для `mt watch`.
- Composite state деривується знизу вверх: усі діти `resolved` → parent `resolved`; є `running` або `pending-audit` → parent `running`; є `failed` без `running` → parent `failed`; є `waiting` без failed/running → parent `waiting`; sentinel `invalidated` у parent має пріоритет.
- Згадані файли/модулі для рефакторингу: `npm/docs/mt.md`, `npm/scripts/graph/`, `npm/scripts/dispatcher/index.mjs`, `npm/bin/n-cursor.js`, `.n-cursor/wake`.

## Update 2026-06-07

Transcript уточнює, що `mode` та `interactive` є ортогональними атрибутами `task.md`: `mode` визначає відповідального директора задачі (`human|agent`), а `interactive` визначає спосіб взаємодії (`true|false`). `mt watch` не повинен автоматично запускати вузли з `mode: human, interactive: true`; такі вузли запускає людина вручну з IDE. Пріоритет значень: CLI-аргумент > `task.md` > `.n-cursor.json`.
