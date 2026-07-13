---
type: ADR
title: Аудит-черга через pending-audit_NNN.md
description: Запит на аудит вузла mt зберігається як numbered файл `pending-audit_NNN.md`, який асинхронно підхоплює `mt watch`.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Після завершення роботи агентом потрібен механізм аудиту якості за критеріями `## Done when` з `task.md`. Стара модель запускала аудит синхронно через flow/wrapper, але нова архітектура `npm/docs/mt.md` базується на файловому стані вузла та черзі, яку сканує `mt watch`. Потрібно визначити, як ставити аудит у чергу і як привʼязувати його до конкретного `outputs_NNN.md`.

## Considered Options

- Синхронний запуск аудитора wrapper-скриптом.
- Порожній sentinel `.pending-audit` без привʼязки до версії outputs.
- Overwrite-файл `.pending-audit` з `ref:` полем.
- Numbered immutable файл `pending-audit_NNN.md`, де NNN дорівнює NNN відповідного `outputs_NNN.md`.

## Decision Outcome

Chosen option: "Numbered immutable файл `pending-audit_NNN.md`", because імʼя файлу саме по собі є посиланням на версію outputs, не потребує окремого `ref:` поля і відповідає принципу файлового стану, який сканує `mt watch`.

### Consequences

- Good, because аудитор точно знає, яку версію `outputs_NNN.md` перевіряти.
- Good, because запит на аудит стає частиною append-only файлового контракту вузла і може оброблятися асинхронно через `mt watch`.
- Good, because повторна доробка природно створює нову пару `outputs_002.md` → `pending-audit_002.md`.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because transcript згадує ліміт 3 поспіль auditor failures, але не містить повної реалізації цього механізму.

## More Information

Файловий контракт:

- `tasks/<node>/outputs_NNN.md` — результат роботи агента.
- `tasks/<node>/pending-audit_NNN.md` — запит на аудит саме `outputs_NNN.md`.
- `run_NNN.md` має незалежний лічильник для всіх акторів.
- `outputs_NNN.md` і `pending-audit_NNN.md` використовують спільний ключ NNN.

Стан `pending-audit`: присутній `pending-audit_NNN.md` без відповідного завершеного auditor-result для цієї версії outputs.

`mt watch` сканує вузли у стані `pending-audit` і запускає auditor-агента. Зафіксовано в контексті `npm/docs/mt.md`, секцій про аудитора, файловий контракт вузла і `mt verify`.

## Update 2026-06-07

Додано уточнення про перевірку після появи `pending-audit_NNN.md`:

- Для `mt verify` обрано гібридний підхід: детермінований скрипт перевіряє структурні інваріанти, а LLM перевіряє семантику `## Done when`.
- Структурні інваріанти включають наявність і непорожність відповідного `outputs_NNN.md`.
- Семантична перевірка читає `task.md ## Done when`, `outputs_NNN.md` і `plan_001.md`.
- PASS можливий лише якщо структурна й семантична перевірки успішні.

Також підтверджено, що `pending-audit_NNN.md` є immutable-запитом, де NNN дзеркалить NNN відповідного `outputs_NNN.md`.
