---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T12:11:15+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Чисто. Всі правки завершено.

**Що змінилось:**
- `deps/` файли — порожні маркери, dep-id = filename without `.md`, абсолютний шлях від `mt/`
- Оркестратор: тільки `ls -R deps/` + strip `.md` — без читання вмісту файлів
- `mt spawn --approve`: резолвить відносні dep-посилання з `## Children` → записує абсолютний filename
- YAML dep-descriptor (`schema_version`, `node:`) — повністю прибрано
- Таблиця summary і scanning scan оновлені відповідно
---

Аналізуємо зауваження по transcript. Потрібно записати ADR-документи для виявлених рішень.

## ADR Уточнення гарантії mt-claim: single publish owner замість mutual exclusion

## Context and Problem Statement
Документ `npm/docs/mt.md` описував гарантію claim як "mutual exclusion", але fencing через `--force-with-lease` на Git ref запобігає лише push у `main`; zombie-runner після takeover може продовжувати виконання і видавати зовнішні side effects.

## Considered Options
* Зберегти термін "mutual exclusion" з розширеним поясненням
* Перейменувати гарантію на "single publish owner" і задокументувати межу fencing

## Decision Outcome
Chosen option: "single publish owner", because термін CS "mutual exclusion" ширший за реальну гарантію — fencing зупиняє лише Git push, не виконання; вживання неточного терміну приховувало клас помилок з non-idempotent side effects.

### Consequences
* Good, because transcript фіксує очікувану користь: авторам задач явно повідомляється що fencing ≠ exclusive execution; документ вимагає idempotency key або передачу `generation` до зовнішніх систем.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/docs/mt.md` — секція Fencing (абзац "Межа fencing"), рядок "Protocol гарантує…", рядок таблиці summary.

---

## ADR Видалення залежності від GitHub Merge API в integration bot

## Context and Problem Statement
Protected-main fallback викликав GitHub Merge API для merge PR, після чого окремим кроком CAS-видаляв claim. Між перевіркою claim і merge існувало вікно TOCTOU: claim міг бути renewed або takeover-нутий, що призводило до merge stale PR або "висячого" claim.

## Considered Options
* Зберегти GitHub Merge API + окремий CAS-delete claim після merge
* Bot виконує `git push --atomic` з трьома `--force-with-lease` (main, claim ref, run ref), PR залишається тільки approval interface

## Decision Outcome
Chosen option: "`git push --atomic` з `--force-with-lease`", because atomic push усуває TOCTOU-вікно: перевірка claim і запис у `main` відбуваються в одній неподільній операції; механізм ідентичний direct-publish path.

### Consequences
* Good, because transcript фіксує очікувану користь: integration bot path отримує ті самі гарантії atomicity що й direct publish; PR merge через GitHub UI більше не є механізмом запису.
* Bad, because bot потребує "bypass branch protection" дозволу в GitHub — explicit writer identity, яка вже передбачена архітектурою.

## More Information
Змінені секції `npm/docs/mt.md`: опис integration bot fallback (~рядок 1170), секція summary table рядок "Lifecycle у main", inline-коментар рядок 874. Команда: `git push --atomic --force-with-lease=refs/heads/main:<sha> --force-with-lease=refs/mt/claims/<hash>:<sha> --force-with-lease=refs/mt/runs/<hash>/<token>:<sha> origin <result>:refs/heads/main :refs/mt/claims/<hash> :refs/mt/runs/<hash>/<token>`.

---

## ADR Відкладений каскад інвалідації як поведінка за замовчуванням

## Context and Problem Statement
`mt invalidate` рекурсивно архівував facts усіх descendants одразу (eager cascade), але пізніше документ стверджував що після re-run descendants можна залишити `resolved` якщо hash не змінився — це логічно неможливо, бо їхні facts вже заархівовані.

## Considered Options
* Зберегти eager cascade + окремий флаг `--defer-cascade` з новим станом `blocked-stale`
* Зробити deferred cascade поведінкою за замовчуванням; використовувати стандартний стан `blocked`; `mt kill` — eager cascade як виняток

## Decision Outcome
Chosen option: "deferred cascade за замовчуванням зі стандартним `blocked`", because eager cascade ніколи не краща за deferred — вона або рівна (hash змінився), або зайво знищує роботу (hash не змінився); окремий стан `blocked-stale` — зайва складність, стандартний `blocked` достатній.

### Consequences
* Good, because transcript фіксує очікувану користь: differential cascade стає логічно консистентним; descendants зберігають facts до підтвердження що hash змінився.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені секції `npm/docs/mt.md`: опис `mt invalidate` (~рядок 883), схема "Каскад інвалідації" (~рядок 1397), рядок таблиці summary "Інвалідація". `mt kill` залишається eager cascade бо там hash-порівняння безглузде.

---

## ADR Розмежування mt invalidate і mt kill у patch protocol та engineer agent

## Context and Problem Statement
Patch protocol (~рядок 1303) і engineer agent protocol (~рядок 1476) використовували `mt kill` для running successors перед патчем, але `mt kill` робить `git rm -r` — вузли видаляються з topology, і "restart каскаду" неможливий без повторної матеріалізації через `mt spawn --approve`.

## Considered Options
* `mt stop` + `mt invalidate` для successors у patch protocol
* `mt invalidate` поглинає stop-логіку (SIGTERM + CAS-delete claim) і викликається напряму; `mt kill` — тільки для остаточного видалення topology

## Decision Outcome
Chosen option: "`mt invalidate` з вбудованою stop-логікою", because це усуває клас помилок між `stop` і `invalidate`; зменшує boilerplate; `mt kill` залишається виключно для постійного видалення topology, що відповідає семантиці "видалити і перевстановити" vs "перезапустити".

### Consequences
* Good, because transcript фіксує очікувану користь: `mt invalidate` безпечно викликається на running вузлі; patch protocol і engineer protocol більше не містять `mt kill` де потрібна лише re-execution.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені секції `npm/docs/mt.md`: `mt invalidate` опис (~рядок 913 — додано SIGTERM + CAS-delete для активного claim), patch protocol (~рядок 1340), engineer agent step 4 (~рядок 1476), "Відмінності від звичайного агента" (~рядок 1483).

---

## ADR Адресація залежностей: filename-as-absolute-id з відносним авторингом у плані

## Context and Problem Statement
Документ містив суперечність: dep-id описувався як відносний до tasks-root, але приклад "сусідній dep" показував скорочене ім'я без батьківського prefixу; пізніші редакції змінили підхід на YAML dep-descriptor з `node:` полем, що вимагало читання вмісту файлу оркестратором і ламало `ls -R deps/` як єдиний спосіб отримати список залежностей.

## Considered Options
* Абсолютні dep-id у filename (рекомендація рев'юера)
* Відносні шляхи від поточного вузла з `__` кодуванням для traversal вгору
* YAML dep-descriptor з `node:` полем у вмісті файлу
* Filename-as-absolute-id зі зберіганням абсолютних шляхів, але відносним авторингом у `## Children`

## Decision Outcome
Chosen option: "filename-as-absolute-id зі відносним авторингом у `## Children`", because зберігається `ls -R deps/` + strip `.md` без читання вмісту; `mt spawn --approve` резолвить відносні посилання плану в абсолютні filenames; оркестратор не потребує контексту поточного вузла для резолюції dep-id.

### Consequences
* Good, because transcript фіксує очікувану користь: dep-id однозначний; оркестратор не читає вміст dep-файлів; авторинг у плані лишається ергономічним (відносні посилання).
* Bad, because `mt spawn --approve` стає відповідальним за резолюцію відносних шляхів — складніша логіка spawn порівняно з простим copy-as-is.

## More Information
Змінені секції `npm/docs/mt.md`: рядок 75-76 (дерево директорій), рядок 146-154 (адресація залежностей), секція `deps/` (~рядок 385-420), deps check у `mt run` (~рядок 785), spawn рядок 1362, summary table рядок "deps/ format", scan algorithm (~рядок 1837).
