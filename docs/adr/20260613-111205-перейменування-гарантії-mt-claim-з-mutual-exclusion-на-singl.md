---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:12:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

## ADR Перейменування гарантії MT claim з "mutual exclusion" на "single publish owner"

## Context and Problem Statement
Документ `npm/docs/mt.md` використовував термін "mutual exclusion" для опису гарантії claim-механізму. Рев'юер зазначив, що fencing через `force-with-lease` на Git ref блокує лише push у `main`; після lease takeover zombie-runner продовжує виконання і може видавати зовнішні side effects (повторна оплата, API-запит, зміна бази даних, deployment, відправлення повідомлення).

## Considered Options
* Залишити термін "mutual exclusion" без змін
* Перейменувати гарантію на "single publish owner" і явно задокументувати межу fencing

## Decision Outcome
Chosen option: "Перейменувати гарантію на "single publish owner"", because fencing фізично зупиняє лише Git-запис; zombie-runner після takeover не має знань про втрату claim і може продовжувати виконання — термін "mutual exclusion" ширший за реальну гарантію.

### Consequences
* Good, because transcript фіксує очікувану користь: документ більше не вводить в оману авторів задач щодо ізоляції виконання.
* Bad, because задачі з non-idempotent side effects тепер явно позначені як несумісні з auto-takeover, що звужує область застосування функції takeover без додаткових вимог (idempotency key або передача `generation` у зовнішню систему).

## More Information
Змінені місця в `npm/docs/mt.md`:
- Секція Fencing — додано абзац "Межа fencing — лише Git publish"
- Рядок "Protocol гарантує mutual exclusion" → "single Git publisher"
- Рядок таблиці summary `Mutual exclusion` → `Single publish owner`

---

## ADR Видалення залежності від GitHub Merge API у protected-main fallback

## Context and Problem Statement
У protected-main fallback integration bot перевіряв claim SHA/token, потім викликав GitHub Merge API для merge PR, і лише після успішного merge CAS-видаляв claim. Між перевіркою та merge-ом claim міг бути renewed (новий SHA, та сама ідентичність runner) або takeover-нутий (новий runner, нове `generation`), що спричиняло TOCTOU race: або "висячий" claim після renewal, або merge stale PR під ownership нового runner після takeover.

## Considered Options
* Залишити GitHub Merge API з додатковим CAS-check безпосередньо перед merge
* Видалити GitHub Merge API: bot виконує той самий `git push --atomic` з `--force-with-lease`, що й direct publisher; PR стає виключно approval interface

## Decision Outcome
Chosen option: "Видалити GitHub Merge API: bot виконує той самий `git push --atomic`", because це усуває TOCTOU повністю — операція оновлення `main`, CAS-видалення claim ref і видалення run ref відбуваються як один атомарний Git push; якщо claim змінився між approval і push, весь push відхиляється.

### Consequences
* Good, because transcript фіксує очікувану користь: protected-main шлях стає ідентичним до direct-publish за гарантіями атомарності.
* Bad, because bot identity потребує "bypass branch protection" дозволу на `main` у GitHub branch protection rules; merge commit більше не відображається в GitHub UI як "merged via PR".

## More Information
Атомарний push bot виконує за тією самою схемою що й direct publisher (`npm/docs/mt.md`, секція direct publish):
```
git push --atomic
--force-with-lease=refs/heads/main:<expected>
--force-with-lease=refs/mt/claims/<hash>:<claim-sha>
--force-with-lease=refs/mt/runs/<hash>/<token>:<run-sha>
origin
<result-sha>:refs/heads/main
:refs/mt/claims/<hash>
:refs/mt/runs/<hash>/<token>
```
Змінені місця в `npm/docs/mt.md`: рядки 874, 1165–1174, 1180, таблиця summary рядок "Lifecycle у main".
