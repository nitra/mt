---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T12:17:00+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Пишу ADR-документи напряму на основі сесії.

## ADR Гарантія single publish owner замість mutual exclusion

## Context and Problem Statement
Документ `npm/docs/mt.md` описував гарантію MT як "mutual exclusion" — але рецензент вказав, що після lease takeover zombie-runner може продовжувати виконання і генерувати зовнішні side effects (платіж, API-запит, зміна БД). Fencing через `git push --force-with-lease` блокує лише запис у `main`, а не виконання процесу.

## Considered Options
* Залишити "mutual exclusion" з поясненням обмежень
* Перейменувати на "single publish owner" і явно описати межу fencing

## Decision Outcome
Chosen option: "перейменувати на single publish owner", because термін "mutual exclusion" є класичним CS-поняттям що означає ексклюзивне виконання critical section, а не лише заборону publish — вживання ширшого за реальну гарантію терміну вводить в оману.

### Consequences
* Good, because transcript фіксує очікувану користь: споживачі протоколу більше не розраховують на зупинку zombie-runner і проектують задачі з урахуванням idempotency або передачі `generation` у зовнішні системи.
* Bad, because задачі з non-idempotent side effects не можна auto-takeover-ити — це обмеження застосовності MT.

## More Information
Файл `npm/docs/mt.md`, рядки ~181-182 (секція Fencing), ~1275 (Protocol гарантує), ~1825 (таблиця summary). Команди: `git push --force-with-lease`, claim refs `refs/mt/claims/<node-hash>`.

---

## ADR Integration bot: fenced atomic push замість GitHub Merge API

## Context and Problem Statement
Integration bot перевіряв claim, потім викликав GitHub Merge API, а після успішного merge — CAS-видаляв claim. Між перевіркою і merge виникає TOCTOU-вікно: claim міг бути renewal або takeover-нутим, і stale PR потрапляв у `main` під ownership нового runner.

## Considered Options
* GitHub Merge API + окремий CAS-delete claim після merge
* Fenced atomic push (`git push --atomic` з `--force-with-lease` на `main`, claim ref і run ref одночасно)

## Decision Outcome
Chosen option: "fenced atomic push", because той самий механізм що й direct-publish усуває TOCTOU повністю — перевірка claim і запис у `main` відбуваються в одній атомарній операції; якщо будь-який ref змінився, push відхиляється цілком.

### Consequences
* Good, because transcript фіксує очікувану користь: PR стає виключно approval interface (review + CI), merge виконує bot через ті самі гарантії що й direct publish; TOCTOU race усунено.
* Bad, because bot identity потребує "bypass required pull requests" дозволу в branch protection — додаткова вимога до налаштування репозиторію.

## More Information
Файл `npm/docs/mt.md`, рядки ~1253-1271. Команда: `git push --atomic --force-with-lease=refs/heads/main:<sha> --force-with-lease=refs/mt/claims/<hash>:<sha> --force-with-lease=refs/mt/runs/<hash>/<token>:<sha> origin <result>:refs/heads/main :refs/mt/claims/<hash> :refs/mt/runs/<hash>/<token>`.

---

## ADR Відкладений cascade для `mt invalidate` замість eager

## Context and Problem Statement
`mt invalidate` рекурсивно архівував весь version chain усіх нащадків одразу. Але документ одночасно стверджував що після re-run нащадків можна залишити `resolved` якщо hash не змінився — що неможливо: їх факти вже заархівовані. Пряма суперечність у специфікації.

## Considered Options
* Eager cascade (архівувати всіх нащадків одразу)
* Deferred cascade (архівувати лише target; нащадки переходять у `blocked` з незачепленими фактами)

## Decision Outcome
Chosen option: "deferred cascade як default", because eager cascade ніколи не кращий за deferred: якщо hash однаковий — eager знищує роботу нащадків даремно; якщо різний — результат ідентичний eager. Deferred завжди ≥ eager за збереженою роботою.

### Consequences
* Good, because transcript фіксує очікувану користь: hash-порівняння після re-run дозволяє уникнути повного пересинтезу downstream коли зміна не впливає на результат.
* Bad, because `mt kill` залишається eager (завжди видаляє downstream) — різна семантика двох команд може бути неочевидною.

## More Information
Файл `npm/docs/mt.md`, рядки ~883-886 (mt invalidate), ~1397-1413 (секція "Каскад інвалідації"). `mt kill` — escape для примусового eager cascade.

---

## ADR `mt invalidate` зупиняє процес внутрішньо; `mt stop` не додається до patch protocol

## Context and Problem Statement
Patch protocol використовував `mt kill` для зупинки running successors перед патчем, але `mt kill` виконує `git rm -r` — знищує topology. "Restart каскаду" після цього неможливий без повторної матеріалізації. Виникло питання: додати `mt stop` як окрему user-facing команду.

## Considered Options
* `mt stop` як окрема команда + `mt invalidate` окремо для patch protocol
* `mt invalidate` сам виконує SIGTERM + CAS-delete claim для running вузлів; `mt stop` без нових user-facing use cases не додається

## Decision Outcome
Chosen option: "`mt invalidate` зупиняє процес внутрішньо", because після аналізу не знайдено standalone сценарію де людині потрібен `mt stop` без подальшого `mt invalidate` або `mt kill`. `mt stop` залишається як internal step і як окрема команда для людського use case (пауза без скидання фактів), але patch protocol використовує `mt stop` + `mt invalidate` — `mt stop` зупиняє successor без архівації, `mt invalidate` — скидає target.

### Consequences
* Good, because transcript фіксує очікувану користь: patch protocol не може випадково знищити topology; topology зберігається, нащадки автоматично стають `blocked` після invalidate target.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`, рядки ~923 (mt invalidate: mode auto/remote SIGTERM), ~1476-1483 (engineer protocol), ~1513 (mt kill eager cascade).

---

## ADR Branch protection — обов'язкова передумова деплойменту MT

## Context and Problem Statement
Fencing через Git CAS гарантується лише для compliant MT runners. Будь-який актор з прямим доступом до репозиторію може push-нути в `main` і обійти механізм. Документ формулював branch protection як умовну рекомендацію ("щоб fencing було security boundary").

## Considered Options
* Branch protection як best-practice з поясненням наслідків відсутності
* Branch protection як mandatory prerequisite; `mt setup` fail closed без неї

## Decision Outcome
Chosen option: "mandatory prerequisite", because без branch protection fencing не є security boundary за визначенням — один non-compliant writer руйнує гарантію для всіх. Fail-closed підхід у `mt setup` робить порушення явним замість мовчазної деградації.

### Consequences
* Good, because transcript фіксує очікувану користь: fencing стає реальним security boundary, а не рекомендацією.
* Bad, because вимагає налаштування "bypass required pull requests" для MT runner і integration bot identities — додаткові операційні вимоги.

## More Information
Файл `npm/docs/mt.md`, секція Bootstrap (крок 0), рядок ~1275. GitHub: Settings → Branches → "Allow specified actors to bypass required pull requests".

---

## ADR `mt kill` перевіряє зворотні залежності перед видаленням

## Context and Problem Statement
`mt kill` видаляв вузол через `git rm -r` не перевіряючи, чи існують live вузли що посилаються на нього через `deps/`. Такі вузли мовчки переходили б у `blocked-invalid-dep` при наступному scan — без попередження і без можливості відмовитись.

## Considered Options
* Документувати наслідок `blocked-invalid-dep` без зміни поведінки `mt kill`
* `mt kill` скануює reverse deps і fail by default якщо є live залежні вузли

## Decision Outcome
Chosen option: "`mt kill` перевіряє reverse deps і fail by default", because знищення topology вузла який ще потрібен іншим вузлам — незворотня деструктивна дія; явна помилка краще ніж тихий граф у broken стані.

### Consequences
* Good, because transcript фіксує очікувану користь: оператор бачить повний список залежних вузлів перед видаленням і може прийняти усвідомлене рішення.
* Bad, because reverse deps scan потребує обходу всього графа — O(n) по кількості вузлів; при великих графах операція може бути повільнішою.

## More Information
Файл `npm/docs/mt.md`, рядки ~923-931 (mt kill). Флаг `--force` дозволяє override; залежні вузли переходять у `blocked-invalid-dep`. `[WARNING]` у `mt status` виводиться окремо від звичайних blocked.

---

## ADR Явний lifecycle clarification → amended: актор, timeout, нагадування

## Context and Problem Statement
Audit clarification flow документував що watch запускає `mt run --actor agent --amend` при наявності `clarification_NNN.md`. Не було визначено: хто пише `amended_NNN.md` для `mode: human` вузлів; який timeout очікування; що відбувається при перевищенні timeout.

## Considered Options
* Залишити actor вибір неявним
* Явно задокументувати actor (залежить від mode) + timeout + нагадування

## Decision Outcome
Chosen option: "явний lifecycle з actor/timeout/reminder", because неоднозначність lifecycle тихо ламається на human-mode вузлах де немає агента для auto-run; timeout без escalation може заморозити аудит-цикл на невизначений термін.

### Consequences
* Good, because transcript фіксує очікувану користь: human-mode вузли отримують сповіщення замість мовчазного очікування; timeout автоматично завершує цикл і вузол повертається до rework.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`, рядки ~652 (`amended_NNN.md` опис), ~1128-1135 (watch flow). Config fields: `clarification_timeout_sec` (дефолт 86400), `clarification_reminder_interval_sec` (дефолт 21600) — додано до `.mt.json`.

---

## ADR Scheduled audit: config-керовані тригери `audit_schedule_days` і `audit_on_patch`

## Context and Problem Statement
Аудит документувався як on-demand операція (агент викликає `mt audit`). Рецензент вказав що `mt watch` може тригерити аудит за розкладом, але умова тригера не визначена.

## Considered Options
* Залишити scheduled audit поза специфікацією (implementation detail)
* Додати config-поля для явного декларування розкладу і тригера при патчі

## Decision Outcome
Chosen option: "config-поля `audit_schedule_days` і `audit_on_patch`", because без явного config scheduled audit неможливо налаштувати або відключити для окремих проектів; декларативний config узгоджується з принципом "все через файли, нічого через окремий state".

### Consequences
* Good, because transcript фіксує очікувану користь: оператор явно контролює коли відбуваються автоматичні аудити; дефолти (`null`, `false`) вимикають поведінку за замовчуванням.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`, секція "Аудит (async черга)" (тригери), `.mt.json` config. Нові поля: `audit_schedule_days: null` (вимкнено), `audit_on_patch: false`. Watch перевіряє вік останнього `audit-result` або `fact_NNN.md` проти `audit_schedule_days`.
