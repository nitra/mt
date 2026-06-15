---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T12:08:59+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Всі 8 місць оновлено. Ось зведення змін:

- **Dep-файли** тепер YAML: `schema_version: 1` + `node:` (замість порожнього або `ref:`)
- **Відносний** `node: collect-data` від `quarterly-anomalies/analyze` → dep-id `quarterly-anomalies/collect-data` (від parent)
- **Абсолютний** `node: /other-branch/node` → dep-id `other-branch/node` (від `mt/` root)
- **Оркестратор** читає `node:` з кожного файлу, а не `ls -R` + strip `.md`
- Ім'я файлу = тільки мітка, не несе semantic
- `mt spawn --approve` пише YAML dep-файли відповідно до `## Children`

Наступне зауваження?

[user]
наступне зауваження

6. Kill protocol не визначає порядок операцій при distributed runnersmt kill описує 5 кроків: перевірку claim, SIGTERM, CAS-delete, worktree remove, архівування. Але кроки 1 і 3 — не атомарні: між перевіркою claim і CAS-delete інший runner може захопити claim. Тоді CAS-delete знищить чужий claim.Рекомендація: Зробити крок 1 (перевірка) і крок 3 (CAS-delete) атомарними через force-with-lease:
git push --force-with-lease=refs/mt/claims/<hash>:<expected-sha> origin :refs/mt/claims/<hash>

---
The transcript ends here.
</thinking>

Now I have the full transcript. Let me generate the ADR documents.
</thinking>

## ADR Уточнення гарантії MT claim: single publish owner, не mutual exclusion

## Context and Problem Statement
Документ `npm/docs/mt.md` описував гарантію MT claim як mutual exclusion виконання. Колега виявив, що fencing через Git refs блокує лише publish до `main`, але не зупиняє zombie-runner після takeover — він може продовжувати виконання й видавати зовнішні side effects (платежі, API-запити, зміни БД, deployments, відправка повідомлень).

## Considered Options
* Залишити термін "mutual exclusion" з розширеним застереженням
* Перейменувати гарантію на "single publish owner" і задокументувати обмеження

## Decision Outcome
Chosen option: "Перейменувати гарантію на single publish owner", because fencing через `force-with-lease` на Git ref фізично зупиняє лише push у `main`; zombie-runner продовжує локальне виконання до власного завершення або kill, тому термін "mutual exclusion виконання" є технічно некоректним.

### Consequences
* Good, because transcript фіксує очікувану користь: документ тепер точно відображає реальні гарантії протоколу, що запобігає помилковому дизайну задач із non-idempotent side effects.
* Bad, because задачі з non-idempotent side effects (платіж, надсилання повідомлення) вимагають явного idempotency key або передачі `generation` у зовнішню систему; auto-takeover для таких задач заборонено.

## More Information
Змінений файл: `npm/docs/mt.md`. Рядки 181–182 (секція Fencing), рядок "Protocol гарантує…", рядок таблиці summary `Mutual exclusion`.

---

## ADR Protected-main fallback: fenced bot push замість GitHub Merge API

## Context and Problem Statement
Integration bot для protected main виконував три окремі кроки: перевірив claim → викликав GitHub Merge API → видалив claim. Між перевіркою і merge існувало TOCTOU вікно: інший runner міг renewal або takeover claim, після чого stale PR потрапляв у `main`, а CAS-delete claim провалювався або знищував чужий claim.

## Considered Options
* Зберегти GitHub Merge API + додати retry-логіку
* Bot виконує атомарний `git push --atomic` з `--force-with-lease` замість Merge API

## Decision Outcome
Chosen option: "Bot виконує атомарний git push", because це усуває TOCTOU повністю — перевірка claim і запис у `main` відбуваються в одній atomic операції, ідентичній до direct publish protocol.

### Consequences
* Good, because transcript фіксує очікувану користь: PR стає виключно approval interface (review + CI), merge виконується через `git push --atomic` з тими ж трьома `--force-with-lease` що й direct publisher.
* Bad, because bot identity потребує bypass-дозволу в branch protection rules (GitHub: "Allow specified actors to bypass required pull requests").

## More Information
Змінені місця у `npm/docs/mt.md`: секція "Protected main fallback" (рядок ~1169), рядок "integration branch + PR + bot" (рядок ~874, ~1180), таблиця summary. Push-команда: `git push --atomic --force-with-lease=refs/heads/main:<expected> --force-with-lease=refs/mt/claims/<hash>:<claim-sha> ...`.

---

## ADR Deferred cascade для mt invalidate: hash-порівняння перед каскадом

## Context and Problem Statement
`mt invalidate` виконував рекурсивний eager cascade — архівував facts усіх нащадків одразу. Водночас документ стверджував, що після re-run нащадки можуть залишитись `resolved` якщо hash не змінився. Це протиріччя: facts нащадків уже заархівовані до моменту hash-порівняння.

## Considered Options
* Додати прапор `--defer-cascade` (opt-in) + новий стан `blocked-stale`
* Зробити deferred cascade поведінкою за замовчуванням; використати стандартний стан `blocked`

## Decision Outcome
Chosen option: "Deferred cascade за замовчуванням зі стандартним blocked", because eager cascade ніколи не краща за deferred: якщо hash змінився — cascade той самий; якщо однаковий — нащадки залишаються `resolved` без зайвої роботи. Новий стан `blocked-stale` не потрібен — коли target йде у `waiting`, нащадки природно стають `blocked` (upstream не `resolved`), їх facts лежать нетронутими.

### Consequences
* Good, because transcript фіксує очікувану користь: уникається зайве повторне виконання нащадків при незмінному результаті target; `mt kill` зберігає eager cascade (там hash-порівняння безглузде — topology видаляється).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені місця у `npm/docs/mt.md`: рядок ~886 (секція `mt invalidate`), секція "Каскад інвалідації" (рядок ~1397), таблиця summary. `mt kill` явно позначений як eager cascade.

---

## ADR Patch protocol: mt invalidate замість mt kill для successors

## Context and Problem Statement
Patch protocol (`npm/docs/mt.md` рядок ~1277) використовував `mt kill` для зупинки running successors перед патчуванням вузла. `mt kill` виконує `git rm -r` — видаляє topology. Після цього "restart каскаду" неможливий без повторної матеріалізації через `mt spawn --approve`, хоча plan не змінювався.

## Considered Options
* `mt kill` для successors (поточна поведінка)
* `mt stop` + `mt invalidate` як окремі кроки
* `mt invalidate` з вбудованою stop-логікою (без окремої команди `mt stop`)

## Decision Outcome
Chosen option: "mt invalidate з вбудованою stop-логікою", because `mt stop` як окрема user-facing команда не має самостійного use case (зупинка без invalidate залишає вузол у невизначеному стані); `mt invalidate` на running вузлі сам виконує SIGTERM + CAS-delete claim перед архівацією, що усуває race між stop і invalidate.

### Consequences
* Good, because transcript фіксує очікувану користь: topology зберігається після patch — orchestrator природно підхоплює нащадків після re-run target; не потрібен `mt spawn --approve` для відновлення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені місця у `npm/docs/mt.md`: patch protocol (~рядок 1340), engineer protocol (~рядок 1476), permissions engineer (~рядок 1483). `mt stop` залишений у документі як CLI-команда для human workflow (пауза без скидання результатів), але не є обов'язковим кроком patch protocol.

---

## ADR Dep-файли: YAML з полем node та hybrid відносна/абсолютна адресація

## Context and Problem Statement
Dep-id у `deps/` визначався з імені файлу (`ls -R deps/` + strip `.md`). Це створювало неоднозначність: для вузла `quarterly-anomalies/analyze` файл `deps/collect-data.md` міг означати кореневий `collect-data` (абсолютна інтерпретація) або сусіда `quarterly-anomalies/collect-data` (відносна), залежно від правил резолюції.

## Considered Options
* Абсолютні шляхи від `mt/` (рекомендація рев'юера): `deps/quarterly-anomalies/collect-data.md`
* Відносні шляхи від поточного вузла (варіант 2): обмежено сусідами та дочірніми, `../` неможливий у файловій системі
* YAML-вміст dep-файлу з полем `node:`: ім'я файлу = мітка; `node: sibling` = відносний від parent; `node: /other` = абсолютний від root (варіант 3, обраний)

## Decision Outcome
Chosen option: "YAML dep-файл з полем node та hybrid адресацією", because filename-as-id не може одночасно підтримувати відносну (сусіди) і абсолютну (cross-level) адресацію без ambiguity; YAML-вміст усуває неоднозначність, дозволяючи провідний `/` як discriminator для абсолютного шляху.

### Consequences
* Good, because transcript фіксує очікувану користь: `node: collect-data` від `quarterly-anomalies/analyze` однозначно резолвиться у `quarterly-anomalies/collect-data`; `node: /other-branch/node` однозначно резолвиться у `other-branch/node`; обидва випадки в одному синтаксисі.
* Bad, because оркестратор тепер читає вміст кожного dep-файлу (а не тільки `ls -R`), що дещо збільшує I/O при batch scan.

## More Information
Змінені місця у `npm/docs/mt.md`: рядки ~76, ~146–150 (формат dep-файлу і правила адресації), секція `deps/` (~рядки 385–415), batch scan (~рядок 785), `mt run` deps check (~рядок 1147), spawn comment (~рядок 1378), orchestrator pseudocode (~рядок 1837), таблиця summary (~рядок 1909). Формат dep-файлу: `schema_version: 1` + `node:` + опціональний `ref:`.

---

## ADR Kill protocol: атомарне CAS-delete claim через force-with-lease

## Context and Problem Statement
`mt kill` виконував перевірку claim (крок 1) і CAS-delete (крок 3) як окремі, не атомарні операції. Між ними інший runner міг захопити claim — тоді CAS-delete знищував чужий claim, залишаючи нового власника без lease.

## Considered Options
* Зберегти двокроковий check + delete з retry-логікою
* Зробити кроки 1 і 3 атомарними через `git push --force-with-lease`

## Decision Outcome
Chosen option: "force-with-lease для CAS-delete claim", because `git push --force-with-lease=refs/mt/claims/<hash>:<expected-sha> origin :refs/mt/claims/<hash>` атомарно перевіряє expected SHA і видаляє ref в одній операції — ідентично механізму direct publish. Якщо claim змінився між check і push — rejected non-fast-forward, kill безпечно завершується з помилкою.

### Consequences
* Good, because transcript фіксує очікувану користь: неможливо випадково видалити чужий claim у distributed середовищі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/docs/mt.md`, секція `mt kill`. Команда для атомарного CAS-delete: `git push --force-with-lease=refs/mt/claims/<hash>:<expected-sha> origin :refs/mt/claims/<hash>`. Зауваження надійшло від колеги як пункт 6 code review. Зміни у документ на момент завершення transcript не були внесені — зауваження лише проаналізовано.
