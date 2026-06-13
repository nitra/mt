---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:12:13+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

## ADR Гарантія MT — single publish owner, не mutual exclusion виконання

## Context and Problem Statement
Документ `npm/docs/mt.md` містив термін "mutual exclusion" для claim-механізму, що вводило в оману: fencing через `force-with-lease` на Git ref блокує лише push у `main`, але не зупиняє zombie-runner від продовження виконання та видачі зовнішніх side effects після takeover.

## Considered Options
* Залишити термін "mutual exclusion" і документувати обмеження в примітці
* Перейменувати гарантію на "single publish owner" та явно описати межу fencing

## Decision Outcome
Chosen option: "Перейменувати на single publish owner", because рецензент вказав, що термін mutual exclusion є технічно некоректним — класичне CS-визначення означає що лише один актор виконує критичну секцію, тоді як фактична гарантія охоплює тільки Git-публікацію.

### Consequences
* Good, because transcript фіксує очікувану користь: читачі документа не матимуть хибного враження, що takeover зупиняє виконання zombie-runner.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінено: рядок summary-таблиці `Claim isolation` → `Single publish owner`; додано абзац "Межа fencing — лише Git publish" у `npm/docs/mt.md` з вимогами щодо non-idempotent side effects (`{node-hash, generation}` або idempotency key із зовнішнього джерела) та забороною auto-takeover для задач без idempotent side effects.

---

## ADR Protected-main fallback: fenced git push замість GitHub Merge API

## Context and Problem Statement
Секція "Protected-main strategy" у `npm/docs/mt.md` описувала flow, де integration bot перевіряє claim SHA/token, потім мержить PR через GitHub Merge API, і лише після цього CAS-видаляє claim. Між перевіркою і merge відкривалось TOCTOU-вікно: інший runner міг renewal або takeover claim, і stale PR потрапляв у `main`.

## Considered Options
* Залишити GitHub Merge API і документувати TOCTOU як known limitation
* Замінити GitHub Merge API на `git push --atomic --force-with-lease` від integration bot; PR залишається виключно approval gate

## Decision Outcome
Chosen option: "git push --atomic --force-with-lease від integration bot", because рецензент обґрунтував: PR як merge mechanism не може бути атомарним з перевіркою claim, тоді як `--force-with-lease` на claim ref і main ref в одному atomic push усуває race window повністю.

### Consequences
* Good, because transcript фіксує очікувану користь: якщо claim змінився між approve і push — `force-with-lease` відхиляє всі refs атомарно, PR залишається відкритим із кодом `claim-changed`.
* Bad, because integration bot потребує push-bypass до `main` (не human-bypass) — це вже закладено в архітектуру (bot є єдиним writer), але вимагає явної конфігурації branch protection.

## More Information
Оновлено рядок 1162–1163 у `npm/docs/mt.md`. Новий push-snippet:
```bash
git push --atomic \
--force-with-lease=refs/heads/main:<expected-main-sha> \
--force-with-lease=refs/mt/claims/<node-hash>:<expected-claim-sha> \
origin \
<run-sha>:refs/heads/main \
<new-claim-sha>:refs/mt/claims/<node-hash> \
:refs/mt/runs/<run-id>
```

---

## ADR Scope ізоляції claim: node-level, не runner-level

## Context and Problem Statement
Документ `npm/docs/mt.md` описував claim isolation як "один runner у вузлі одночасно", не уточнюючи що обмеження існує лише на рівні вузла. Сценарій multi-tasking agent (runner одночасно тримає кілька claim-ів) не порушує протокол, але документ не давав цього зрозуміти.

## Considered Options
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Явно зафіксувати node-level scope", because рецензент зазначив, що відсутність явного формулювання ставить розробників перед хибним припущенням про runner-level mutual exclusion.

### Consequences
* Good, because transcript фіксує очікувану користь: multi-tasking runner scenario (взяв 3 вузли, впав, один ще живий) не порушує протокол і кожен вузол ізольований незалежно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Оновлено: рядок summary-таблиці `Claim isolation` → `Claim isolation (node-level)` із приміткою; додано абзац "Scope ізоляції — node-level, не runner-level" в `npm/docs/mt.md`. Для runner-level обмежень (max задач на runner, one-task-per-runner) потрібен окремий registry або resource-limit поза MT.

---

## ADR Зовнішній fencing key: {node-hash, generation}, не тільки generation

## Context and Problem Statement
Рядок 190 `npm/docs/mt.md` рекомендував передавати `generation` як idempotency key у зовнішні системи (payment processor тощо). Але `generation` — монотонний лічильник у межах одного вузла; два різних вузли можуть мати однаковий `generation`. Зовнішня система, яка обслуговує кілька вузлів, не може унікально ідентифікувати запит лише за `generation`.

## Considered Options
* Передавати тільки `generation`
* Передавати комбінований ключ `{node-hash, generation}` або `claim_id = node-hash + token`

## Decision Outcome
Chosen option: "Комбінований ключ {node-hash, generation} або claim_id", because `token` є uuid4 унікальним per-claim (задокументовано в тому ж файлі), а `node-hash` унікально ідентифікує вузол — комбінація дає глобально унікальний ключ.

### Consequences
* Good, because transcript фіксує очікувану користь: зовнішні системи можуть безпечно відхиляти дублікати навіть при multi-node сценаріях.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Оновлено рядок 190 у `npm/docs/mt.md`. Поле `generation` (рядок 81) залишається незмінним у своєму описі: "монотонний лічильник у межах вузла; збільшується при renewal і takeover".

---

## ADR Heartbeat loop для виявлення zombie-runner

## Context and Problem Statement
У `npm/docs/mt.md` (Direct publish protocol) runner верифікував свій claim лише безпосередньо перед publish (крок 6). Для довготривалих задач runner міг залишатися zombie-процесом після takeover протягом усього виконання, видаючи зовнішні side effects, і виявляв факт втрати claim лише при спробі publish.

## Considered Options
* Перевірка claim лише перед publish (поточний підхід)
* Periodic heartbeat loop: runner re-reads і верифікує claim ref кожні N секунд

## Decision Outcome
Chosen option: "Periodic heartbeat loop (рекомендовано для довготривалих задач)", because рецензент обґрунтував: раннє виявлення takeover дозволяє cancel task і зупинити side effects до їх фактичного настання, а не після.

### Consequences
* Good, because transcript фіксує очікувану користь: zombie-runner може бути зупинений значно раніше, зменшуючи вікно для дублювання non-idempotent side effects.
* Bad, because transcript не містить підтверджених негативних наслідків (додаткові Git read операції кожні N секунд — явного заперечення в transcript немає).

## More Information
Додано абзац "Heartbeat loop (рекомендовано для довготривалих задач)" у Direct publish protocol `npm/docs/mt.md`, між кроком renewal і секцією "Межа fencing". Рекомендована реакція на `claim-lost` у heartbeat: негайно скасувати задачу і зупинити зовнішні side effects.
