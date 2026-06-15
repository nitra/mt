---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:55:30+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

## ADR `mt kill`-only підхід відхилено: три окремі команди kill / stop / invalidate

## Context and Problem Statement
Під час обговорення patch protocol було запропоновано спростити CLI, прибравши `mt stop` і `mt invalidate` на користь єдиної команди `mt kill`. Потрібно було оцінити, чи ця трейд-офф прийнятна.

## Considered Options
* `mt kill`-only: topology відновлюється через `mt init` + `mt spawn --approve`
* Три окремі команди: `mt kill` / `mt stop` / `mt invalidate` з різними семантиками

## Decision Outcome
Chosen option: **"Три окремі команди"**, because `mt kill`-only руйнує три властивості:
1. **Differential cascade** — після `mt init` descendants завжди виконуються заново, незалежно від hash
2. **Planning overhead** — вузол заново проходить `mt plan`; human review LLM-генерованого плану повторюється
3. **Pause-семантика** — неможливо тимчасово зупинити вузол без руйнування topology

`mt kill`-only — свідома спрощуюча трейд-офф (не помилка), але вона обнуляє весь deferred cascade і вимагає видалення цієї логіки зі специфікації.

ADR збережено в `docs/adr/20260613-mt-kill-only-відхилено-три-команди-kill-stop-invalidate.md`. Рішення є доповненням до вже наявних ADR-чернеток за сьогодні (11:48:57), які покривають decisions 1–4 цієї сесії.
