---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T12:07:39+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Коміт пройшов. Що зроблено:

- `npm/docs/mt.md` — 9 зауважень вирішено, 4 задокументовані як misread
- `npm/docs/review-response.md` — структурована відповідь для рецензента з рішенням по кожному пункту
- `npm/.changes/` — change-файл для наступного patch release

---

Тепер виконую свою частину роботи — генерую ADR за цією сесією.

---

## ADR Термінологія гарантії MT claim: single publish owner замість mutual exclusion

## Context and Problem Statement
Рецензент зауважив що `mt.md` використовував термін "mutual exclusion" для опису гарантії claim-протоколу. Fencing через `force-with-lease` на Git refs блокує лише запис у `main`; zombie-runner після takeover може продовжувати виконання і видавати зовнішні side effects.

## Considered Options
* Залишити "mutual exclusion" з уточнювальним дрібним шрифтом
* Перейменувати гарантію на "single publish owner" і явно зафіксувати межу fencing

## Decision Outcome
Chosen option: "single publish owner", because термін точно відображає реальну гарантію системи: лише один runner може записати результат у `main`. Mutual exclusion виконання не гарантується і вводив читача в оману щодо side effects.

### Consequences
* Good, because transcript фіксує очікувану користь: усуває клас помилок де задачі з non-idempotent side effects auto-takeover-яться без idempotency key.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`; секція Fencing; таблиця summary (рядок `Single publish owner`).

---

## ADR Integration bot: fenced atomic push замість GitHub Merge API

## Context and Problem Statement
Protected-main fallback в `mt.md` описував flow де integration bot перевіряє claim, потім викликає GitHub Merge API, потім CAS-видаляє claim. Між перевіркою та merge існує TOCTOU race: claim може бути renewed або takeover-нутий, після чого stale PR потрапляє у `main`.

## Considered Options
* GitHub Merge API + окрема CAS-delete claim після merge (поточний підхід)
* Fenced atomic `git push --atomic` з `--force-with-lease` на main, claim ref та run ref одночасно

## Decision Outcome
Chosen option: "fenced atomic git push", because це усуває TOCTOU повністю — перевірка claim і запис у main відбуваються в одній атомарній операції, ідентично до direct publish протоколу.

### Consequences
* Good, because transcript фіксує очікувану користь: integration bot має ті ж атомарні гарантії що й direct publisher.
* Bad, because bot потребує bypass branch protection дозволу для прямого push у protected main.

## More Information
Файл `npm/docs/mt.md`; секція "Protected main fallback"; `git push --atomic --force-with-lease`.

---

## ADR Deferred differential cascade як default поведінка mt invalidate

## Context and Problem Statement
`mt invalidate` одночасно архівував version chain усіх descendants (eager cascade), але документ також описував що після re-run descendants можна залишити `resolved` якщо hash не змінився — що є логічно неможливим якщо їх факти вже заархівовані.

## Considered Options
* Прапор `--defer-cascade` як opt-in з новим станом `blocked-stale`
* Deferred cascade як default без нового стану — нащадки природно стають `blocked` через відсутність resolved upstream

## Decision Outcome
Chosen option: "deferred cascade як default без нового стану", because eager cascade ніколи не краща за deferred (або рівна — якщо hash змінився, або зайво знищує роботу). Стандартний стан `blocked` достатній — upstream не `resolved` робить нащадків `blocked` автоматично.

### Consequences
* Good, because transcript фіксує очікувану користь: уникається непотрібне перевиконання нащадків коли зміна upstream не впливає на їх результат.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`; секція "Каскад інвалідації"; `mt kill` залишається eager cascade для остаточного видалення topology.

---

## ADR mt invalidate як безпечний entrypoint для running вузлів

## Context and Problem Statement
Patch protocol використовував `mt kill` для зупинення running successors перед патчем, але `mt kill` видаляє topology через `git rm -r` — після чого "restart каскаду" неможливий без повторної матеріалізації. Окрема послідовність `mt stop` + `mt invalidate` описана в рецензії як правильна альтернатива.

## Considered Options
* `mt stop` + `mt invalidate` як два явні кроки в patch protocol
* `mt invalidate` сам виконує stop-логіку для running вузлів

## Decision Outcome
Chosen option: "`mt invalidate` виконує SIGTERM + CAS-delete claim перед архівацією", because це спрощує протокол (один крок замість двох) і усуває клас помилок де між stop і invalidate інший runner встигає retake claim.

### Consequences
* Good, because patch protocol спрощено; `mt stop` залишається як окрема команда для людського use case (пауза без скидання результатів).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`; секція "Wrapper-скрипт" (крок 10); "Протокол патчу вузла"; "Engineer protocol".

---

## ADR Абсолютні шляхи від tasks-root для dep-id

## Context and Problem Statement
Документ описував "sibling dep" через короткий dep-id (напр. `deps/collect-data.md` → dep-id `collect-data`), що коректно лише для root-level вузлів. У вкладеному контексті `quarterly-anomalies/analyze` той самий запис вказував би на `mt/collect-data/` замість `mt/quarterly-anomalies/collect-data/`.

## Considered Options
* Structured YAML dep-файл з полем `node:` і `schema_version:`
* Абсолютні dep-id від tasks-root як єдина конвенція

## Decision Outcome
Chosen option: "абсолютні dep-id від tasks-root", because filename-as-id простіший і консистентніший; structured YAML додає складність без реальної користі. Правило "завжди повний шлях від tasks-root" усуває двозначність на будь-якому рівні вкладеності.

### Consequences
* Good, because transcript фіксує очікувану користь: dep-id однозначний незалежно від глибини вузла.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`; секція "Deps" (рядки 145–151); приклад nested sibling dep `deps/quarterly-anomalies/collect-data.md`.

---

## ADR mt cleanup як окрема CLI команда для orphan worktrees

## Context and Problem Statement
Після failed runs worktrees залишались у `.worktrees/` для debug. Без явного cleanup механізму при частих падіннях директорія накопичувала сотні worktrees. Єдиним GC механізмом був `mt watch`.

## Considered Options
* Тільки автоматичне очищення всередині `mt watch`
* Окрема команда `mt cleanup [--older-than N]` плюс виклик з `mt watch`

## Decision Outcome
Chosen option: "окрема команда + виклик з mt watch", because `mt watch` може не запускатись у CI/CD або single-run environments; оператор повинен мати явний інструмент без залежності від watch.

### Consequences
* Good, because transcript фіксує очікувану користь: orphan worktrees не накопичуються в середовищах де watch не запущений.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл `npm/docs/mt.md`; секція "mt cleanup"; CLI-список команд. Default `--older-than 7` (днів).
