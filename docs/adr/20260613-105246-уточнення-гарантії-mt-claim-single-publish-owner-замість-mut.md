---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T10:52:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

## ADR Уточнення гарантії MT claim: single publish owner замість mutual exclusion

## Context and Problem Statement

Документ `npm/docs/mt.md` описував гарантію системи MT як "mutual exclusion" виконання задач. Колега зауважив, що після lease takeover zombie-runner може продовжувати виконання і видавати зовнішні side effects (повторна оплата, API-запити, зміни бази даних, deployment, відправлення повідомлень), навіть якщо fencing блокує лише публікацію результату в Git.

## Considered Options

* Залишити термін "mutual exclusion" та розширити fencing на external side effects
* Перейменувати гарантію на "single publish owner" і задокументувати вимогу idempotency для задач із зовнішніми side effects

## Decision Outcome

Chosen option: "Перейменувати гарантію на single publish owner + задокументувати вимогу idempotency", because fencing через Git refs технічно забезпечує лише єдиного writer у `main`; зупинити виконання процесу zombie-runner засобами Git-протоколу неможливо.

### Consequences

* Good, because документ тепер точно відображає межі гарантії: fencing захищає лише Git-публікацію, а не виконання задачі в цілому.
* Bad, because задачі з неідемпотентними side effects не можуть автоматично takeover-итись — це звужує сценарії автоматичного відновлення.

## More Information

Змінено три місця у `npm/docs/mt.md`:
1. Рядок таблиці `| Mutual exclusion |` → `| Single publish owner |` із оновленим описом.
2. Секція з рядком "Protocol гарантує mutual exclusion лише для compliant MT runners" → переформульовано як "single Git publisher".
3. Після секції **Fencing** (рядки 181–182) додано абзац: zombie-runner може продовжувати виконання; fencing не зупиняє external side effects; задачі без ідемпотентних side effects не повинні автоматично takeover-итись; рекомендовано передавати `fencing generation` у зовнішні системи або використовувати idempotency key.
