---
type: ADR
title: Read-only UI для моніторингу графу mt
description: UI має бути read-only переглядачем станів task-графу, а всі керуючі дії залишаються в CLI.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Архітектура `npm/docs/mt.md` описує файловий task-граф, де стан вузлів визначається файлами в `tasks/<node>/`. Людині потрібен інтерфейс для щоденного моніторингу, розслідування `failed` або `invalidated` вузлів і перегляду прогресу складених задач. Потрібно визначити роль UI відносно CLI.

## Considered Options

- Read-only UI: сканує файловий стан, показує дерево вузлів, деталі `task.md` і `run_NNN.md`, а керуючі дії залишає CLI.
- UI як control plane з кнопками `kill`, `run`, редагуванням `task.md` та іншими діями.
- DAG-граф зі стрілками замість tree-view.
- SSE або real-time stream замість polling.

## Decision Outcome

Chosen option: "Read-only UI", because transcript визначає UI як observability tool: стан читається з файлів через `mt scan --json`, а всі дії (`mt kill`, `mt run`, патчі) виконуються через CLI.

### Consequences

- Good, because UI прямо відображає контракт моніторингу з `npm/docs/mt.md`: scan файлів → показ станів → людина читає → людина діє через CLI.
- Good, because tree-view відповідає фізичній структурі вкладених директорій `tasks/` і не додає складності DAG-рендерингу без підтвердженої користі для read-only переглядача.
- Neutral, because polling `mt scan --json` обрано замість SSE через файлову природу стану: сервер теж дізнається про зміни тільки після сканування.
- Bad, because transcript не містить підтвердження негативних наслідків read-only підходу.

## More Information

UI flow з transcript:

- щоденний моніторинг: відкрити UI → побачити дерево вузлів зі станами `waiting`, `running`, `resolved`, `failed`, `invalidated` → auto-refresh через polling;
- розслідування інциденту: клік на `failed` або `invalidated` вузол → панель деталей з `task.md`, `run_001.md`, `run_002.md` і `## Reasoning` → дія через CLI;
- прогрес складеної задачі: розгорнути кореневий вузол → побачити дочірні вузли і їхні стани.

У UI не додаються кнопки `kill` / `run`, редагування `task.md`, повний inline-вміст великих `outputs_NNN.md` або real-time stream логів агента.
