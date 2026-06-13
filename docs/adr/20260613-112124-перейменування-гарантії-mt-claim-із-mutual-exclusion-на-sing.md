---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:21:24+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

## ADR Перейменування гарантії `mt-claim` із mutual exclusion на single publish owner

## Context and Problem Statement
Документ `npm/docs/mt.md` описував гарантію claim-механізму як "mutual exclusion", що є класичним CS-терміном, який означає виключне виконання критичної секції. Колега-рев'юер зауважив, що після takeover старий runner продовжує локальне виконання — fencing через `force-with-lease` на Git ref блокує лише push у `main`, але не зупиняє зовнішні side effects (оплата, API-запит, зміна бази, deployment, повідомлення). Термін "mutual exclusion" вводив в оману щодо реальної ширини гарантії.

## Considered Options
* Залишити термін "mutual exclusion" із розширеним поясненням
* Перейменувати гарантію на "single publish owner" і задокументувати межі fencing

## Decision Outcome
Chosen option: "Перейменувати гарантію на single publish owner", because fencing фізично захищає лише запис у `main`; виконання zombie-runner і всі його side effects поза межами цієї гарантії.

### Consequences
* Good, because термін точно описує реальну поведінку протоколу: лише один runner може опублікувати Git-результат у `main`.
* Bad, because задачі з non-idempotent side effects потребують явного механізму захисту (idempotency key або передача `generation` у зовнішню систему); документ накладає цю вимогу на авторів задач, а не вирішує її автоматично.

## More Information
Змінено три місця у `npm/docs/mt.md`:
- секція Fencing (бл. рядок 181) — доданий абзац "Межа fencing — лише Git publish" із рекомендацією щодо idempotency key / `generation` для external systems; зафіксовано, що задачі без idempotent side effects не можна auto-takeover-ити
- рядок "Protocol гарантує…" — "mutual exclusion" → "single Git publisher"
- рядок таблиці summary — `Mutual exclusion` → `Single publish owner`

---

## ADR Усунення залежності від GitHub Merge API в integration-bot fallback

## Context and Problem Statement
Protected-main fallback у `npm/docs/mt.md` (бл. рядок 1168) описував flow: integration bot перевіряє claim → викликає GitHub Merge API → після merge CAS-видаляє claim. Між перевіркою та merge виникає TOCTOU race: інший runner може renewal або takeover claim, і stale PR потрапляє у `main` з некоректним ownership.

## Considered Options
* Залишити GitHub Merge API з додатковою перевіркою після merge
* Замінити GitHub Merge API на прямий `git push --atomic` з тими самими `--force-with-lease` що і в direct publish

## Decision Outcome
Chosen option: "Замінити GitHub Merge API на прямий `git push --atomic`", because atomic push з трьома `--force-with-lease` (main, claim ref, run ref) є тією самою операцією що й direct publish і не має TOCTOU window — якщо хоча б один CAS не пройшов, push відхиляється цілком.

### Consequences
* Good, because integration-bot fallback отримує ті самі атомарні гарантії що й direct-publish шлях; TOCTOU race усунено.
* Good, because PR залишається approval interface (review + CI), але сам механізм запису в `main` стає незалежним від GitHub API.
* Bad, because bot потребує "bypass branch protection" дозволу в GitHub (Allow specified actors to bypass required pull requests); GitHub не позначатиме commit як "merged via PR" у стандартному UI — transcript фіксує, що це несуттєво для MT.

## More Information
Змінено чотири місця у `npm/docs/mt.md`:
- головний опис integration-bot fallback (бл. рядок 1169) — повністю переписаний: runner відкриває PR тільки для approval, bot після approve виконує `git push --atomic --force-with-lease=<main> --force-with-lease=<claim> --force-with-lease=<run>`, потім видаляє integration branch
- рядок з описом fallback (бл. рядок 1175) — "integration bot/PR" → "fenced integration bot (PR = approval-only)"
- рядок таблиці summary "Lifecycle у main"
- рядок 874 (короткий reference) — `integration branch + PR + bot` → `integration branch + PR (approval-only) + fenced bot push`

---

## ADR Deferred cascade як поведінка за замовчуванням в `mt invalidate`

## Context and Problem Statement
`mt invalidate` в `npm/docs/mt.md` описував eager cascade: рекурсивно архівує `fact_*.md` всіх descendants одразу, після чого (рядок 1408) стверджував, що після re-run нащадки можна залишити `resolved`, якщо hash нового факту збігається з попереднім. Рев'юер зафіксував суперечність: якщо cascade вже заархівував факти нащадків, залишити їх `resolved` фізично неможливо — їх `fact_*.md` вже в `history/`.

## Considered Options
* Зберегти eager cascade, видалити рядок про hash-порівняння (відмовитись від differential cascade)
* Ввести `--defer-cascade` як opt-in флаг (рекомендація рев'юера)
* Зробити deferred cascade поведінкою за замовчуванням без окремого флага

## Decision Outcome
Chosen option: "Deferred cascade за замовчуванням без окремого флага", because eager cascade є завжди ≥ deferred за обсягом роботи і ніколи не краща: якщо hash змінився — cascade однаковий; якщо не змінився — eager зайво знищує вже виконану роботу нащадків.

### Consequences
* Good, because деталі нащадків залишаються непорушеними до підтвердження зміни hash; при незмінному hash нащадки автоматично продовжують роботу без повторного виконання.
* Good, because окремий стан `blocked-stale` не потрібен — стандартний `blocked` достатній, оскільки нащадки природно переходять у `blocked` коли upstream не є `resolved`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено три місця у `npm/docs/mt.md`:
- секція `mt invalidate` (бл. рядок 883) — видалено рядок eager recursive cascade; додано опис deferred-поведінки: target архівує свій version chain і переходить у `waiting`, нащадки стають `blocked` (upstream не `resolved`), їх `fact_*.md` не зачіпаються
- секція "Каскад інвалідації" (бл. рядок 1397) — приклад і пояснення диференційного cascade переписані: cascade на нащадків запускається тільки після порівняння hash нового факту
- рядок таблиці summary "Інвалідація" — оновлено опис cascade-поведінки
