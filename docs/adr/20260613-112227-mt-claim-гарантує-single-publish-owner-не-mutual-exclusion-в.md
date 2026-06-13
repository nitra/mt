---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:22:27+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Тепер у мене є весь transcript. Продукую MADR-рішення.

---

## ADR mt-claim гарантує single publish owner, не mutual exclusion виконання

## Context and Problem Statement
Документ `npm/docs/mt.md` описував гарантію claim-механізму терміном "mutual exclusion", але fencing через Git CAS зупиняє лише push у `main`. Zombie-runner після lease takeover може продовжувати виконання та видавати зовнішні side effects (оплата, API-запит, зміна бази даних, deployment, повідомлення).

## Considered Options
* Залишити термін "mutual exclusion", але уточнити його межі
* Перейменувати гарантію на "single publish owner" і задокументувати вимоги до side effects

## Decision Outcome
Chosen option: "Перейменувати гарантію на single publish owner", because fencing фізично не зупиняє виконання процесу — вона лише блокує запис у `main`; термін "mutual exclusion" некоректно описував реальну гарантію системи.

### Consequences
* Good, because transcript фіксує очікувану користь: розробники задач явно бачать межу гарантії і знають, що side effects потребують idempotency key або передачі `generation` у зовнішню систему.
* Bad, because задачі з non-idempotent side effects не можна auto-takeover-ити без додаткових заходів — це архітектурне обмеження, зафіксоване в документі.

## More Information
Змінено в `npm/docs/mt.md`: секція Fencing (додано абзац "Межа fencing — лише Git publish"), рядок "Protocol гарантує…" (mutual exclusion → single Git publisher), рядок таблиці summary (`Mutual exclusion` → `Single publish owner`).

---

## ADR Protected-main fallback через fenced bot push замість GitHub Merge API

## Context and Problem Statement
Integration bot для protected `main` перевіряв claim, потім викликав GitHub Merge API, і лише після успішного merge CAS-видаляв claim. Між перевіркою та merge існувало TOCTOU-вікно: renewal або takeover могли змінити claim SHA, через що stale PR міг потрапити у `main` або claim залишався "висячим".

## Considered Options
* GitHub Merge API + окремий CAS-delete claim після merge
* Bot виконує `git push --atomic` з тими ж `--force-with-lease` що й direct publish; PR залишається як approval interface

## Decision Outcome
Chosen option: "Bot виконує `git push --atomic` з force-with-lease", because GitHub Merge API не є атомарним відносно claim ref, тоді як `git push --atomic` оновлює `main`, claim ref і run ref в одній операції — TOCTOU усунено так само як у direct publish protocol.

### Consequences
* Good, because transcript фіксує очікувану користь: protected-main шлях отримує ті самі атомарні гарантії що й direct publish; TOCTOU race повністю усунено.
* Bad, because bot потребує bypass-дозволу на protected `main` в branch protection rules; GitHub не відображатиме merge commit як "merged via PR" у стандартному вигляді.

## More Information
Змінено в `npm/docs/mt.md`: секція з описом integration bot fallback (чотири місця); команда бота: `git push --atomic --force-with-lease=refs/heads/main:<expected> --force-with-lease=refs/mt/claims/<hash>:<claim-sha> --force-with-lease=refs/mt/runs/<hash>/<token>:<run-sha> origin <result-sha>:refs/heads/main :refs/mt/claims/<hash> :refs/mt/runs/<hash>/<token>`. PR закривається ботом після push.

---

## ADR Деферований cascade як дефолтна поведінка `mt invalidate`

## Context and Problem Statement
`mt invalidate` рекурсивно архівував `fact_*.md` всіх нащадків, але секція "Диференційний cascade" стверджувала, що після нового виконання нащадки можуть "залишитись `resolved`" — логічна суперечність, бо їхні факти вже було заархівовано.

## Considered Options
* Immediate cascade (попередня поведінка): `mt invalidate` рекурсивно архівує і переводить нащадків у `unassigned`
* Deferred cascade як дефолт: нащадки переходять у `blocked-stale`; реальний cascade відкладається до hash-порівняння після нового виконання
* `--defer-cascade` як явний прапор, immediate cascade — дефолт

## Decision Outcome
Chosen option: "Deferred cascade як дефолт", because зберігає факти нащадків нетронутими до моменту рішення — дозволяє уникнути зайвого re-execution якщо hash target-вузла не змінився; старий eager режим доступний через `--eager-cascade`.

### Consequences
* Good, because transcript фіксує очікувану користь: нащадки у `blocked-stale` повертаються до `resolved` без re-execution якщо hash збігся; заощадження обчислювальних ресурсів.
* Bad, because додано новий стан `blocked-stale` до state machine і нова поведінка `mt invalidate` потребує явного `--eager-cascade` для випадків де hash гарантовано зміниться.

## More Information
Змінено в `npm/docs/mt.md`: enum станів (додано `blocked-stale`), секція `mt invalidate` (рядок "Тригерить recursive cascade" → "Нащадки переходять у `blocked-stale`", додано `--eager-cascade`), секція "Диференційний cascade" (виправлено логіку — hash порівнюється з архівованим фактом target-вузла, нащадки в `blocked-stale` або повертаються до `resolved` або отримують реальний `mt invalidate`).

---

## ADR Orchestrator як єдиний caller `mt done` для `spawned`-вузла

## Context and Problem Statement
`mt done` описувався як операція runner-а що тримає claim. Але після `mt spawn` батьківський вузол переходить у стан `spawned` і чекає на резолв дітей — claim на батька не утримується. Документ не визначав, хто і коли викликає `mt done` на `spawned`-вузла.

## Considered Options
* Останній дочірній runner перевіряє siblings і ініціює wrapper flow
* Оркестратор (окремий daemon/loop) моніторить дочірні вузли і клеймить батька після завершення всіх дітей
* Спеціальна структурна задача-координатор

## Decision Outcome
Chosen option: "Оркестратор", because batch-перевірка без race між siblings; оркестратор є centralized і вже є частиною архітектури MT.

### Consequences
* Good, because transcript фіксує очікувану користь: `spawned`-вузол має чітко визначеного caller для `mt done`; claim preconditions table задокументована.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено в `npm/docs/mt.md`: таблиця "Claim preconditions" (додано рядки для `spawned`: `accepted` лише коли всі діти `resolved` і caller = orchestrator; `rejected-children-not-resolved` інакше); "Wrapper pattern" розгорнуто до: orchestrator → `mt claim <parent-path>` → aggregate → `mt done <parent-path>`; `mt spawn` possible results вже містить `rejected-cycle`.

---

## ADR `failed-dependency` як окремий стан для вузлів з failed залежністю

## Context and Problem Statement
Вузол у стані `blocked` не мав визначеного переходу коли блокуюча залежність переходила у `failed` — потенційно залишаючись `blocked` назавжди без жодного механізму розблокування.

## Considered Options
* Переводити вузол у `failed` (існуючий стан)
* Ввести `failed-dependency` як окремий стан

## Decision Outcome
Chosen option: "`failed-dependency` як окремий стан", because дозволяє оркестратору розрізняти "вузол впав через власне виконання" від "вузол не запускався бо залежність впала"; полегшує фільтрацію і діагностику.

### Consequences
* Good, because transcript фіксує очікувану користь: orchestrator може окремо обробляти `failed-dependency` і `failed`; краща діагностика першопричини.
* Bad, because state machine збільшується на один стан; усі місця де перевіряється `status == failed` потребують врахування `failed-dependency`.

## More Information
Додано до `npm/docs/mt.md`: `failed-dependency` у enum станів; опис стану; перехід `blocked` → `failed-dependency` (тригерить оркестратор коли залежність переходить у `failed`); рядок у orchestration state-machine table.
