---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:48:57+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

## ADR Гарантія mt-протоколу: single publish owner, не mutual exclusion виконання

## Context and Problem Statement
Документ `npm/docs/mt.md` описував гарантію фенсингу терміном "mutual exclusion", що є некоректним: fencing через `--force-with-lease` на Git ref блокує лише запис у `main`, але не зупиняє виконання zombie-runner після takeover. Той може продовжувати і видавати зовнішні side effects.

## Considered Options
* Залишити термін "mutual exclusion" і додати застереження про обмеження
* Перейменувати гарантію на "single publish owner" і задокументувати вимоги до side effects

## Decision Outcome
Chosen option: "single publish owner", because термін точно відображає фактичну гарантію: `force-with-lease` гарантує лише один writer у `main`, а не відсутність паралельного виконання.

### Consequences
* Good, because transcript фіксує очікувану користь: користувачі протоколу не матимуть хибних припущень про mutual exclusion виконання; вимога idempotency key або передачі `generation` в зовнішні системи зроблена явною.
* Bad, because задачі з non-idempotent side effects отримують обмеження: заборона auto-takeover без ручного втручання.

## More Information
Змінено рядки ~202–204, ~1229, ~1904 у `npm/docs/mt.md`. Додано абзац "Межа fencing — лише Git publish" у секцію Fencing. Рядок таблиці summary перейменовано з `Mutual exclusion` на `Single publish owner`.

---

## ADR Integration bot: виключення залежності від GitHub Merge API

## Context and Problem Statement
Протокол protected-main fallback використовував GitHub Merge API для злиття PR. Між перевіркою claim integration bot-ом і фактичним merge існувало TOCTOU-вікно: claim міг бути renewed або taken over, після чого stale PR потрапляв у `main`.

## Considered Options
* Зберегти GitHub Merge API; додати повторну перевірку claim після merge
* Integration bot виконує `git push --atomic` з `--force-with-lease` безпосередньо, PR залишається лише approval interface

## Decision Outcome
Chosen option: "Integration bot виконує fenced atomic push", because це усуває TOCTOU-вікно: перевірка claim і запис у `main` відбуваються в одній атомарній операції, ідентичній до direct publish path.

### Consequences
* Good, because transcript фіксує очікувану користь: protected-main шлях отримує ті самі атомарні гарантії що й direct publish; TOCTOU race повністю усунений.
* Bad, because integration bot потребує "bypass branch protection" дозволу в GitHub (стандартна практика для CI-ботів, але потребує явного налаштування); commit у `main` не відображається як "merged via PR" у GitHub UI.

## More Information
Змінено секцію "protected main fallback" (~рядки 1200–1215), рядки ~1233, ~890, ~1916 у `npm/docs/mt.md`. Bot flow: runner відкриває PR (approval-only) → бот отримує approved PR → `git push --atomic --force-with-lease` на `main` + claim ref + run ref → бот закриває integration branch.

---

## ADR Відкладений cascade у `mt invalidate` замість eager

## Context and Problem Statement
`mt invalidate` рекурсивно архівував facts усіх descendants одразу, але spec одночасно стверджував що після re-run нащадки можна залишити `resolved` якщо hash не змінився — це суперечність, бо їх facts вже були заархівовані cascade.

## Considered Options
* `--defer-cascade` як окремий opt-in флаг
* Eager cascade залишити як default; виправити тільки текст
* Deferred cascade як default: архівувати лише target, descendants природно стають `blocked`; cascade тригериться лише при зміні hash

## Decision Outcome
Chosen option: "deferred cascade як default", because eager cascade ніколи не краща за deferred — при однаковому hash вона зайво знищує роботу нащадків; при різному hash результат той самий. `--defer-cascade` як окремий флаг непотрібний.

### Consequences
* Good, because transcript фіксує очікувану користь: differential cascade тепер фізично можливий — facts нащадків лишаються нетронутими до порівняння hash; зайве повторне виконання усунено.
* Bad, because `mt kill` залишається єдиним eager-cascade шляхом, що вимагає чіткого розмежування між командами в документації.

## More Information
Змінено опис `mt invalidate` (~рядок 913–917), секцію "Каскад інвалідації" (~рядок 1438), рядок таблиці (~рядок 1884) у `npm/docs/mt.md`. `blocked` (стандартний стан) є достатнім — новий стан `blocked-stale` не вводився.

---

## ADR `mt invalidate` інтегрує stop-логіку; `mt stop` — не CLI-команда для patch protocol

## Context and Problem Statement
Patch protocol використовував `mt kill` для зупинки running successors, але `mt kill` виконує `git rm -r` і знищує topology. Після kill "restart каскаду" неможливий без повторної матеріалізації через `mt spawn`. Альтернативно розглядалась окрема команда `mt stop` як перший крок у patch protocol.

## Considered Options
* Залишити `mt kill` у patch protocol; виправити тільки документацію
* Ввести `mt stop` як user-facing CLI-команду; patch protocol = `mt stop` + `mt invalidate`
* `mt invalidate` сам виконує SIGTERM + CAS-delete claim на running вузлі; `mt stop` існує лише для явного human use case, не для patch protocol

## Decision Outcome
Chosen option: "`mt invalidate` інтегрує stop-логіку", because конкретного сценарію де людині потрібен `mt stop` без подальшого `mt invalidate` або `mt kill` — не знайдено; інтеграція усуває вікно між двома окремими командами коли хтось міг би retake claim між `mt stop` і `mt invalidate`.

### Consequences
* Good, because transcript фіксує очікувану користь: patch protocol став одним кроком замість двох для running вузлів; помилка класу "call-stop-but-forget-invalidate" унеможливлена.
* Bad, because `mt stop` залишається в документі як окрема команда (для human pause без скидання facts), що потребує пояснення відмінності від `mt invalidate`.

## More Information
Змінено `mt invalidate` (~рядок 913): додано обробку active claim перед архівацією (local: SIGTERM + CAS-delete; remote: CAS-delete). Patch protocol (~рядок 1476) виправлено з `mt kill <dep-node>` на `mt stop <dep-node>` + `mt invalidate <dep-node>`. `mt kill` залишено лише для остаточного видалення topology.
