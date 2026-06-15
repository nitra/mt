---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:56:08+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Продукую ADR-блоки безпосередньо на основі аналізу transcript.

---

## ADR Перейменування гарантії «mutual exclusion» → «single publish owner»

## Context and Problem Statement
Документ `npm/docs/mt.md` оголошував гарантію MT-claim як «mutual exclusion», використовуючи цей класичний CS-термін у таблиці summary (рядок ~1825) та в тексті протоколу (~рядок 1172). Рецензент зазначив, що fencing через `git force-with-lease` фізично зупиняє лише push у `main`, але не зупиняє виконання zombie-runner після lease takeover: той може продовжувати роботу та видавати зовнішні side effects (повторна оплата, API-запит, зміна DB, deployment, повідомлення).

## Considered Options
* Залишити термін «mutual exclusion» з уточнювальним коментарем
* Перейменувати гарантію на «single publish owner» і додати явні вимоги до side effects

## Decision Outcome
Chosen option: «Перейменувати на single publish owner і задокументувати обмеження», because fencing через `force-with-lease` гарантує лише єдиного writer у `main`; «mutual exclusion» означало б блокування всього виконання, що механізм не забезпечує.

### Consequences
* Good, because transcript фіксує очікувану користь: документ точно описує реальну гарантію; задачі з non-idempotent side effects отримують явну вимогу передавати `generation` або використовувати idempotency key; заборона auto-takeover для задач без idempotent side effects.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/docs/mt.md`. Змінено три місця: секцію Fencing (додано абзац «Межа fencing — лише Git publish»), рядок «Protocol гарантує single Git publisher» (замість «mutual exclusion»), рядок таблиці summary `Mutual exclusion` → `Single publish owner`.

---

## ADR Integration bot використовує fenced git push замість GitHub Merge API

## Context and Problem Statement
Protected-main fallback у `npm/docs/mt.md` (~рядок 1172) описував flow: bot перевіряє claim SHA/token → викликає GitHub Merge API → CAS-видаляє claim. Між перевіркою та merge-ом існує TOCTOU-вікно: claim може бути renewed (bot не зможе CAS-видалити, claim зависає) або takeover-нутий (stale PR старого runner потрапляє у `main` під ownership нового runner).

## Considered Options
* Використовувати GitHub Merge API з retry/re-check логікою
* Bot виконує той самий `git push --atomic` з `--force-with-lease`, що й direct publisher; PR — тільки approval interface

## Decision Outcome
Chosen option: «Bot виконує fenced `git push --atomic`», because атомарний push з трьома `--force-with-lease` (main, claim ref, run ref) усуває TOCTOU повністю: якщо claim змінився між approval і push, операція відхиляється цілком.

### Consequences
* Good, because transcript фіксує очікувану користь: protected-main шлях отримує ті самі гарантії що й direct publish; TOCTOU race усунено; backoff/retry при конфлікті — той самий механізм.
* Bad, because GitHub не відображатиме merge як «merged via PR» у стандартному вигляді — але transcript фіксує що для MT це не має значення.

## More Information
Файл: `npm/docs/mt.md`. Bot потребує «bypass branch protection» дозвіл (GitHub підтримує для bot identities аналогічно Dependabot). Змінено: секція protected-main fallback переписана на `git push --atomic`; таблиця summary entry lifecycle: «PR (approval-only) + fenced bot push»; рядок ~874: «integration branch + PR (approval-only) + fenced bot push».

---

## ADR Deferred cascade як поведінка за замовчуванням для `mt invalidate`

## Context and Problem Statement
У `npm/docs/mt.md` існувала суперечність: рядок ~886 описував eager cascade («кожен нащадок отримує `mt invalidate` рекурсивно»), а рядок ~1408 стверджував що після повторного виконання нащадки можуть залишитись `resolved`, якщо hash не змінився. Це неможливо: їхні `fact_*.md` вже заархівовано попереднім cascade.

## Considered Options
* Eager cascade як default, `--defer-cascade` як opt-in флаг; новий стан `blocked-stale` для нащадків (пропозиція рецензента)
* Deferred cascade як default без нового стану; нащадки природно стають `blocked` через відсутність resolved upstream; `mt kill` зберігає eager cascade

## Decision Outcome
Chosen option: «Deferred cascade як default, стандартний `blocked`, без нового стану», because eager cascade ніколи не краща за deferred: вона або рівна (hash змінився) або зайво знищує роботу (hash не змінився); `blocked` достатній, бо нащадки автоматично блокуються коли upstream переходить у `waiting`.

### Consequences
* Good, because transcript фіксує очікувану користь: диференційний cascade стає логічно несуперечливим; при однаковому hash нащадки не перевиконуються; `mt kill` явно зберігає eager cascade для остаточного видалення.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/docs/mt.md`. Змінено: з опису `mt invalidate` прибрано «Cascade вниз по нащадках»; додано deferred behavior (target архівується, нащадки → `blocked`, hash-порівняння після re-run); діаграма в секції «Каскад інвалідації» оновлена на two-branch flow (однаковий hash / різний hash); таблиця summary оновлена.

---

## ADR `mt invalidate` самостійно зупиняє running вузол; `mt stop` не додається як окрема CLI-команда

## Context and Problem Statement
Рецензент запропонував `mt stop` як окрему CLI-команду для явного SIGTERM + release claim перед `mt invalidate`. Виникло питання: чи є сценарій де людині потрібен `mt stop` без подальшого `mt invalidate` або `mt kill`.

## Considered Options
* `mt stop` як обов'язковий окремий крок перед `mt invalidate` (пропозиція рецензента)
* `mt invalidate` самостійно виконує SIGTERM + CAS-delete claim перед архівацією; `mt stop` не додається як user-facing команда

## Decision Outcome
Chosen option: «`mt invalidate` виконує stop-логіку внутрішньо», because жодного конкретного сценарію де людині потрібен `mt stop` без подальшого `mt invalidate` чи `mt kill` не знайдено; окрема команда усувається клас помилок — вікно між `mt stop` і `mt invalidate` де інший runner може retake claim.

### Consequences
* Good, because transcript фіксує очікувану користь: протокол спрощується (один крок замість двох); вікно retake між stop і invalidate усунено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/docs/mt.md`, рядок ~913: «Якщо вузол має активний claim: локальний runner → SIGTERM + CAS-delete claim перед архівацією; remote runner → CAS-delete claim (remote детектує втрату при наступному renewal)». Примітка: `mt stop` залишається в документі як частина patch protocol flow (де successors зупиняються окремо від target), але `mt invalidate` більше не вимагає попереднього явного виклику `mt stop`.

---

## ADR Patch protocol використовує `mt stop` + `mt invalidate` замість `mt kill`

## Context and Problem Statement
Оригінальний patch protocol у `npm/docs/mt.md` (~рядки 1303–1308) використовував `mt kill synthesize` та `mt kill analyze` для звільнення running successors, після чого пропонував «restart каскаду». Але `mt kill` виконує `git rm -r`, фізично видаляючи вузли; restart cascade після цього неможливий без повторної матеріалізації через `mt spawn --approve`. Аналогічна помилка існувала в engineer protocol (~рядок 1476): `mt kill <dep-node>` одразу за яким редагувався `task.md` у вже видаленому вузлі.

## Considered Options
* `mt kill` для successors (поточний стан)
* `mt stop` для running successors (звільняє claim, зберігає topology і facts) + `mt invalidate` для target вузла

## Decision Outcome
Chosen option: «`mt stop` + `mt invalidate`», because plan не змінювався — нащадки ті самі; потрібно лише скинути execution state, а не знищувати topology; після `mt invalidate` target нащадки природно стають `blocked` з нетронутими facts.

### Consequences
* Good, because transcript фіксує очікувану користь: topology зберігається; restart cascade можливий автоматично; усунено логічну помилку в engineer protocol де `task.md` редагувався після `git rm`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/docs/mt.md`. Змінено: patch protocol крок 2 — `mt kill` → `mt stop`; engineer protocol крок 4 — `mt kill <dep-node>` → `mt stop <dep-node>` + `mt invalidate <dep-node>`; permissions engineer agent уточнено: `mt kill` лише для остаточного видалення topology.

---

## ADR `mt kill` зарезервовано виключно для постійного видалення topology

## Context and Problem Statement
Після низки виправлень у `npm/docs/mt.md` постало питання чи варто взагалі розрізняти `mt kill` та `mt invalidate` — або перейти тільки на `mt kill` для спрощення CLI.

## Considered Options
* Використовувати лише `mt kill` скрізь (прибрати `mt invalidate`)
* Зберегти обидві команди: `mt invalidate` для скидання execution state зі збереженням topology, `mt kill` лише для постійного видалення

## Decision Outcome
Chosen option: «Зберегти обидві команди з чіткими різними семантиками», because «mt kill only» втрачає три критичні властивості: (1) кожен re-run вимагав би `mt kill + mt init + mt spawn --approve` — overhead для найпоширенішого сценарію; (2) диференційний cascade зникає — завжди повний пересинтез; (3) оркестратор втрачає здатність відновити вузол без external state.

### Consequences
* Good, because transcript фіксує очікувану користь: `mt invalidate` зберігає `task.md`, `a.md/h.md`, `deps/`, `plan_*` і дозволяє автоматичний re-run; диференційний cascade залишається ефективним.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `npm/docs/mt.md`. Семантика зафіксована в таблиці: `mt invalidate` — topology зберігається, use case: результат невалідний але задача та сама, re-run автоматичний; `mt kill` — topology видаляється, use case: задача змінилась або вузол не потрібен, re-run вручну через `mt init + mt spawn`. Аналогія з transcript: «перезапустити сервіс» (`mt invalidate`) vs «видалити і перевстановити» (`mt kill`).
