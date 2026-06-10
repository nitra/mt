# Архітектура: Динамічний Самомодифікований Граф Задач

## Назва структури

**Рекурсивний складений ОАГ** (орієнтований ациклічний граф) — із динамічним розкладом вузлів та файловим сховищем стану.

---

## Концепція

### Вузол

Кожен вузол або є атомарним, або розкладається на підграф — рішення приймається **динамічно в Stage 1** на основі вхідних даних.

```
Вузол
  ├── реалізація:
  │     ├── Атомарний  — fn(вхідні) → вихідні
  │     └── Складений  — Граф{ вхід, вузли[], ребра[], виходи[] }
  ├── стан: unassigned | pending | waiting | blocked | running | stalled | pending-audit | resolved | failed
  ├── вхідні:  Map<portId, Value>
  └── вихідні: Map<portId, Value>   ← заповнюється при resolved
```

Для батьківського вузла інтерфейс однаковий: він чекає `resolved` не знаючи що всередині (**інкапсуляція чорної скриньки**).

### Граф

- **ОАГ** — орієнтований, без циклів
- **Ребра** — потік даних: виходи одного вузла стають входами наступного
- **Вхідний вузол** — отримує вхідні дані батьківського складеного вузла
- **Вихідні вузли** — кілька, їх виходи зливаються у виходи батька
- Складений вузол може бути замінений атомарним і навпаки без змін у батьківському графі

```
СкладенийВузол
  └── Граф
        ├── вхід    → отримує вхідні дані батька
        ├── вузли[]: Вузол[]
        ├── ребра[]: { від: ВузолId+portId, до: ВузолId+portId }
        └── виходи[]: Вузол[]   ← кілька, злиття → виходи батька
```

**Топологія живе у `deps/` директорії кожного дочірнього вузла.** Жодного центрального файлу графу. Оркестратор відновлює повний граф скануванням усіх `task.md` і `deps/`.

---

## Naming convention вузлів

- Дозволені символи: `a-z`, `0-9`, `-`
- Роздільник: `-`
- Унікальність: в межах батька (серед сусідів в тій самій директорії)
- Приклади: `collect-data`, `analyze-results`, `synthesize`
- `id` вузла = назва директорії (не дублюється у фронтматері)
- Атрибути фронтматеру — англійські, snake_case
- **Всі імена файлів і директорій — англійська** (обробляються скриптами)
- Заголовки секцій що парсить скрипт — англійські; секції з довільними даними — будь-яка мова

---

## Файловий контракт вузла

### Структура

Дочірні вузли живуть **безпосередньо** в директорії батька. Якщо директорія містить `task.md` — це вузол.

```
mt/
  <node-id>/
    task.md                  ← місія (immutable після mt init)
    a.md                     ← прапор: виконує агент (model_tier, skills)
    h.md                     ← прапор: виконує людина (qualification)
    deps/                    ← залежності: кожен файл = назва dep-вузла (з .md розширенням)
      <dep-node-id>.md       ← порожній або містить ref: для контексту
    plan_NNN.md              ← Stage 1 output (numbered, immutable; 001 при першому або після kill)
    running_<pid>_until_<ts> ← git-ignored; локальна observability, НЕ lock
    run-summary.md           ← mutable; LLM-generated summary попередніх failed run_*.md
    run_NNN.md               ← спроба виконавця: agent | engineer | human (аудитор НЕ пише)
    fact_NNN.md              ← успішний результат; NNN = NNN відповідного run_NNN.md
    pending-audit_NNN.md     ← запит аудиту; NNN = NNN відповідного fact_NNN.md
    audit-result_NNN.md      ← відповідь аудитора (окремий трек); NNN = NNN pending-audit_NNN.md
    run_summary.md           ← синтез всіх run_NNN.md після N failed спроб (пише аудитор)
    clarification_NNN.md     ← уточнення агента після needs-clarification аудиту
    amended_NNN.md           ← виправлена відповідь агента на зауваження аудитора
    history/                 ← локальний аудит-trail: invalidate/kill архіви
      <ts>-invalidate/       ← архів fact_*.md + run_*.md при mt invalidate
    <child-node-id>/         ← дочірній вузол (composite spawn)
      task.md
      a.md | h.md
      deps/
      ...                    ← та сама структура рекурсивно
```

`a.md` і `h.md` — **мутабельні прапори**, НЕ immutable артефакти. Визначають **хто** виконує: `a.md` = агент, `h.md` = людина. Можна видалити `h.md` і створити `a.md` для перемикання режиму. Ніколи обидва одночасно.

### Інваріанти

**Формат:** Markdown з YAML-фронтматером.

- Атрибути фронтматеру → **англійські, snake_case**
- Заголовки секцій що парсить скрипт → **англійські**
- Секції з довільними даними → **будь-яка мова**

**Immutable файли** (не змінюються після створення): `task.md`, `plan_NNN.md`, `run_NNN.md`, `fact_NNN.md`, `pending-audit_NNN.md`, `clarification_NNN.md`, `amended_NNN.md`. Новий факт = новий файл.

**Мутабельні прапори** (НЕ immutable): `a.md`, `h.md`, `running_<pid>_until_*`, `approved`, `run-summary.md`.

**Authoritative execution claim** живе не у файловій структурі вузла, а у GitHub custom ref:

```
refs/mt/claims/<node-hash>
```

`node-hash` = перші 20 hex символів SHA-256 від канонічного `<tasks-root>\0<node-path>`. Це уникає конфлікту
Git refs, де одночасно не можуть існувати ref `a` і ref `a/b`.

Claim ref вказує на commit з файлом `.mt-claim.yml`:

```yaml
schema_version: 1
node: research/analyze
actor: agent
runner_id: server-1/4821
claimed_at: 2026-06-09T10:00:00Z
lease_until: 2026-06-09T11:00:00Z
token: 1d9c87d2-4f41-4e74-91c2-2d873a62bf04
generation: 1
base_sha: a1b2c3
run_ref: refs/mt/runs/<node-hash>/<token>
```

Remote claim ref — єдине джерело правди щодо ownership. Локальний `running_<pid>_until_<ts>` допомагає знайти
процес на конкретному host, але його наявність або відсутність не дає права запускати чи публікувати вузол.

**Audit result:** `audit-result_NNN.md` є immutable відповіддю аудитора. Якщо факт треба переробити, `mt invalidate <path>` починає нову version chain замість перезапису попереднього результату.

`schema_version:` — перше поле у всіх файлах з YAML-фронтматером. Поточна версія: `1`. Оркестратор відмовляє читати файли з невідомою версією. Breaking schema changes постачаються як окремий major release MT з явним описом переходу.

**`deps/`** — директорія залежностей. Файли в ній: immutable після worktree. `deps/` може бути вкладеною директорією, яка дзеркалює структуру `mt/`. Всі файли мають розширення `.md`. `ls -R deps/` → шлях відносно `mt/` (після обрізання `.md` суфіксу) = dep-id. Вміст опціональний: `ref:` для контексту. Відсутня `deps/` або порожня = немає залежностей.

**Cross-level залежності:** `deps/` підтримує вкладену структуру для крос-рівневих залежностей. Сусідній dep: `deps/collect-data.md` → dep-id = `collect-data`. Cross-level dep: `deps/research/analyze.md` → dep-id = `research/analyze` → `mt/research/analyze/fact_*.md`. `ls -R deps/` дає повний перелік — без читання вмісту.

**Naming convention deps/:** всі файли у `deps/` мають розширення `.md`. Агент завжди пише `<dep-node-id>.md` — ніколи без розширення.

**Локальний runtime marker:** `running_<pid>_until_<ts>` — **git-ignored**, ephemeral observability marker.
Пишеться wrapper після успішного remote claim і видаляється при local cleanup. PID дозволяє `kill -0 <pid>` на тому
самому host. Marker не синхронізується через Git, не є lock і не використовується для distributed ownership.

**Claim acquisition — atomic compare-and-swap через Git remote:**

1. Runner отримує `origin/main` і перевіряє claim через `git ls-remote`.
2. Якщо claim відсутній — створює claim commit від поточного `origin/main`.
3. Створює claim ref лише за умови, що remote ref досі відсутній:

   ```bash
   git push \
     --force-with-lease=refs/mt/claims/<node-hash>: \
     origin \
     <claim-sha>:refs/mt/claims/<node-hash>
   ```

4. Лише accepted push дає право створити worktree. Rejected push означає, що інший runner уже володіє вузлом.
5. Renewal і takeover виконуються тільки з exact expected SHA:

   ```bash
   git push \
     --force-with-lease=refs/mt/claims/<node-hash>:<old-claim-sha> \
     origin \
     <new-claim-sha>:refs/mt/claims/<node-hash>
   ```

Новий claim commit має parent = попередній claim commit. Renewal зберігає `token` і `generation`, але пересуває
claim SHA та `lease_until`; takeover створює новий `token` і збільшує `generation`. Два одночасні renew/takeover
від одного SHA створюють divergent commits; remote приймає лише один.

**Fencing:** перед publish runner повторно читає claim ref і перевіряє exact claim SHA, `token`, `generation` та
`lease_until`. Runner, який втратив claim, не має права оновлювати `main`, навіть якщо його локальний процес ще живий.

Custom refs підтверджено практичним push/read/delete тестом на GitHub. Вони не з'являються у звичайному списку
branches і не fetch-яться стандартним refspec, тому MT завжди використовує explicit `git ls-remote`, `git fetch`
та повне ім'я ref. GitHub branch protection rules на `refs/mt/*` не поширюються; право їх змінювати визначається
write-доступом Git credential.

**Межа immutability:**

- До створення worktree — файли вузла можна вільно редагувати і видаляти
- Після створення worktree — лише новий вміст, нічого не змінюється

**Синтаксис посилань** (у `## Inputs` секції `task.md` та в `fact_NNN.md`):

```
ref: ../collect-data/fact_001.md              # весь файл (відносно поточного файлу)
ref: ../collect-data/fact_001.md#results      # секція за заголовком
ref: ../collect-data/fact_001.md lines 5-20  # діапазон рядків
```

**Єдина NNN-шкала — version chain.**

`run_NNN.md` є коренем: wrapper рахує існуючі `run_*.md` → наступний NNN. Всі похідні файли успадковують NNN від run:

| Файл                   | Звідки NNN                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| `run_NNN.md`           | sequential counter (N-та спроба)                                   |
| `fact_NNN.md`          | NNN = NNN run що її створив                                        |
| `pending-audit_NNN.md` | NNN = NNN відповідного `fact_NNN.md`                               |
| `audit-result_NNN.md`  | NNN = NNN відповідного `pending-audit_NNN.md`                      |
| `clarification_NNN.md` | NNN = NNN відповідного `audit-result_NNN.md` (needs-clarification) |
| `amended_NNN.md`       | NNN = NNN відповідного `audit-result_NNN.md` (needs-clarification) |

`fact_NNN.md` може не існувати для певного NNN — "дірка" означає що спроба N завершилась з `result: failed`.

Watch перевіряє "чи оброблено" без читання файлів: `pending-audit_003.md` оброблено ↔ існує `audit-result_003.md`.

Zero-padded до 3 цифр: `001`, `002`, …

`plan_NNN.md` — окрема логіка:

- Worktree **merged** або робота **продовжується** в ньому → нумерація продовжується (`002`, `003`, …)
- `mt kill` → видаляє всі `plan_*.md` файли вузла → наступний старт з `plan_001.md`

Актуальний `plan_NNN.md` — файл з найбільшим номером.

---

### Схеми файлів

#### `task.md`

Тільки місія. **Immutable після `mt init`**. Не містить інформацію про виконавця — вона в `a.md`/`h.md`.

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:00:00Z
budget_sec: 600 # м'який ліміт — агент перевіряє через ENV
budget_hard_sec: 0 # hard kill; 0 = вимкнено; default = budget_sec × budget_hard_sec_multiplier
progress_timeout_sec: 300 # kill якщо немає змін у worktree N сек (опціонально)
hint: atomic # опціонально: atomic | composite — підказка агенту
parent: research/collect-data # відносно mt/; відсутній у кореневого
---

## Task

Що саме має виконати цей вузол.

## Done when

Чіткий критерій: що означає "resolved".

## Inputs

Контекст від батька або inline-дані (не залежності — ті у `deps/`).

### instruction

Обробити лише перші 50 результатів, ігнорувати дублікати.
```

| Поле / секція          | Обов'язкове | Примітка                                                                     |
| ---------------------- | ----------- | ---------------------------------------------------------------------------- |
| `created_at`           | так         | ISO 8601, перше поле                                                         |
| `budget_sec`           | так         | секунди; м'який ліміт — агент сам перевіряє залишок через ENV                |
| `budget_hard_sec`      | ні          | hard kill; 0 = вимкнено; default = `budget_sec × budget_hard_sec_multiplier` |
| `progress_timeout_sec` | ні          | kill якщо немає змін `mtime` у worktree N сек                                |
| `hint`                 | ні          | підказка агенту щодо типу вузла (atomic/composite)                           |
| `parent`               | ні          | відносно `mt/`; відсутній у кореневого                                       |
| `## Task`              | так         | —                                                                            |
| `## Done when`         | так         | —                                                                            |
| `## Inputs`            | ні          | відсутній якщо батько нічого не передає і немає inline-даних                 |

Пріоритет budget-полів: CLI-аргумент > `plan_NNN.md` > `.mt-override.json` > `task.md` > `.mt.json`.

---

#### `a.md`

Мутабельний прапор. Якщо є — вузол виконує **агент**. При перемиканні: видалити `h.md`, створити `a.md`.

```yaml
schema_version: 1
created_at: ISO8601
model_tier: AVG # MIM | AVG | MAX
skills:
  - bash
  - write-files
context_runs: auto # auto = structured summary + 50% fallback; або явне число
```

| Поле             | Обов'язкове | Примітка                                                      |
| ---------------- | ----------- | ------------------------------------------------------------- |
| `schema_version` | так         | завжди `1` (перше поле)                                       |
| `created_at`     | так         | ISO 8601                                                      |
| `model_tier`     | ні          | `MIM` \| `AVG` \| `MAX`; default: `AVG`                       |
| `skills`         | ні          | список інструментів агента (bash, write-files, web-search, …) |
| `context_runs`   | ні          | `auto` = structured summary + 50% fallback; або явне число    |

---

#### `h.md`

Мутабельний прапор. Якщо є — вузол виконує **людина**. При перемиканні: видалити `a.md`, створити `h.md`.

```yaml
schema_version: 1
created_at: ISO8601
email: engineer@example.com
notify: true
qualification: 'senior backend engineer'
```

| Поле             | Обов'язкове | Примітка                                |
| ---------------- | ----------- | --------------------------------------- |
| `schema_version` | так         | завжди `1` (перше поле)                 |
| `created_at`     | так         | ISO 8601                                |
| `email`          | ні          | email для notify                        |
| `notify`         | ні          | `true` — надсилати нагадування на email |
| `qualification`  | ні          | рівень і спеціалізація виконавця        |

---

#### `deps/` — залежності вузла

Директорія присутня якщо вузол має попередників. Кожен файл = одна залежність. `deps/` може бути вкладеною директорією — дзеркалює структуру `mt/`.

```
deps/
  collect-data.md        ← сусід (mt/<task>/../collect-data/)
  fetch-sources.md
  research/
    analyze.md           ← крос-рівневий (mt/research/analyze/)
```

Ім'я файлу (відносний шлях від `deps/`) = шлях dep-вузла відносно `mt/`. Всі файли в `deps/` мають розширення `.md`. `ls -R deps/` → шляхи → обрізати `.md` → dep-id.

| Елемент                                       | Значення                                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Назва файлу (або шлях у вкладеній директорії) | Ідентифікатор dep-вузла відносно `mt/`. Сусідні deps: `deps/collect-data.md`. Крос-рівневі deps: `deps/research/analyze.md`. `ls -R deps/` → обрізати `.md` → dep-id. |
| Наявність файлу                               | dep існує; `ls -R deps/` → список dep-id без читання вмісту                                                                                                           |
| Вміст                                         | опціональний: `ref:` на `fact_NNN.md` попередника + контекст для агента                                                                                               |

**Deps satisfaction:** `ls -R deps/` → для кожного path → обрізати `.md` суфікс → dep-id = відносний шлях від `mt/` → перевірити `mt/<dep-id>/fact_*.md`.

**Приклад `deps/collect-data.md`:**

```markdown
ref: ../collect-data/fact_001.md#results
Використовувати лише перші 50 записів, ігнорувати дублікати.
```

---

---

#### `plan_NNN.md`

Stage 1 output. Immutable. `001` при першому плануванні або після `mt kill`; `002`, `003`, … якщо worktree merged або продовжується.

```markdown
---
schema_version: 1
created_at: ISO8601
decision: atomic | composite
budget_sec: 3600 # уточнений бюджет (перекриває task file; опціонально)
budget_hard_sec: 10800 # уточнений hard limit (0 = без kill; опціонально)
progress_timeout_sec: 600 # kill якщо немає змін у worktree N сек (опціонально)
---

## Context

Чому саме такий підхід.

## Approach

<!-- atomic: покроковий план виконання -->
<!-- composite: список дочірніх вузлів з описами та dep-зв'язками -->

## Risks

Що може піти не так.
```

Пріоритет budget-полів: `plan_NNN.md` > `.mt-override.json` > task file > `.mt.json`.

`plan_NNN.md` не містить поле `mode:` — mode визначається `a.md`/`h.md`, які є єдиним джерелом правди щодо виконавця.

Після запису `plan_NNN.md` для composite вузлів — стан переходить у `plan-review`. `mt spawn --approve` або `mt spawn --reject`. Без approve — жодних дочірніх вузлів. Для атомарних вузлів `plan-review` не застосовується.

---

#### `fact_NNN.md`

Immutable. Успішний вихід вузла. NNN = NNN відповідного `run_NNN.md` (wrapper записує з тим самим NNN). Якщо `run_NNN.md` має `result: failed` — `fact_NNN.md` не існує (дірка у нумерації). Скрипт читає файл з найбільшим NNN як актуальний.

`## Summary` — обов'язкова перша секція для observability. Решта — довільні порти для наступників.

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:05:00Z
hash: sha256:<hash секції ## Result>
---

## Summary

Проаналізовано 847 записів, виявлено 3 аномалії у секції payments.

## anomalies

ref: data/anomalies.json

## full-report

ref: reports/payment-report.md
```

| Секція          | Обов'язкова | Правило                           |
| --------------- | ----------- | --------------------------------- |
| `## Summary`    | так         | одне речення, inline              |
| довільні секції | ні          | `ref:` якщо є файл, інакше inline |

Агент вільно створює файли де завгодно в проєкті; `fact_NNN.md` посилається через `ref:`.

---

#### `run_NNN.md`

Immutable. Один файл на одну спробу виконавця. Записується **після** завершення. Аудитор `run_NNN.md` не пише.

`result: success` → wrapper також пише `fact_NNN.md` з тим самим NNN; `run_NNN.md` містить `## Ref → fact_NNN.md`.
`result: failed` → `fact_NNN.md` не створюється; `run_NNN.md` містить весь контент спроби: `## Reasoning` + `## Partial Work` якщо є часткові результати.

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:01:00Z
actor: agent
result: failed
worktree: .worktrees/research-analyze-1749200400 # тільки якщо failed — для debug
---

## Reasoning

Спробував обробити весь датасет одразу — задача занадто велика.

## Script

exit_code: 1
stderr: Error: context length exceeded 200k tokens

## Ref

ref: fact_001.md
```

| Поле / секція     | Хто пише   | Коли                                        | Що містить                                   |
| ----------------- | ---------- | ------------------------------------------- | -------------------------------------------- |
| `created_at`      | wrapper    | завжди                                      | ISO 8601                                     |
| `actor`           | wrapper    | завжди                                      | `agent` \| `engineer` \| `human`             |
| `result`          | wrapper    | завжди                                      | `success` \| `failed`                        |
| `worktree`        | wrapper    | якщо failed                                 | шлях до worktree (для debug)                 |
| `## Reasoning`    | виконавець | failed: обов'язково; success: рекомендовано | чому так, що вирішив, що спробував           |
| `## Completed`    | виконавець | **обов'язково при failed**                  | що вдалось виконати до зупинки               |
| `## Blockers`     | виконавець | **обов'язково при failed**                  | конкретні блокери для швидкої діагностики    |
| `## Partial Work` | виконавець | опціонально (failed)                        | часткові результати, дані, незавершений код  |
| `## Next Attempt` | виконавець | **обов'язково при failed**                  | рекомендація для наступного агента/інженера  |
| `## Script`       | wrapper    | якщо crash                                  | `exit_code:`, `stderr:`                      |
| `## Changes`      | engineer   | опціонально                                 | список файлів змінених у патчі               |
| `## Ref`          | виконавець | якщо success                                | `ref: fact_NNN.md` (обов'язково при success) |

Агент може додавати довільні секції — схема фіксує відомі з конкретними правилами.

---

#### `pending-audit_NNN.md`

Immutable. NNN = NNN відповідного `fact_NNN.md`. Створюється через `mt audit`.

```markdown
---
schema_version: 1
created_at: ISO8601
actor: agent | human
---
```

---

#### `audit-result_NNN.md`

Immutable. NNN = NNN відповідного `pending-audit_NNN.md`. Пишеться виключно аудитором. Невдалий аудит не перезаписується: наступна спроба проходить через `mt invalidate`, новий run і новий fact.

```markdown
---
schema_version: 1
created_at: ISO8601
actor: auditor
result: success | failed | needs-clarification
---

## Reasoning

Що перевірено, що схвалено або що конкретно не відповідає ## Done when.
```

| Поле           | Значення                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `actor`        | завжди `auditor`                                                                                                                          |
| `result`       | `success` → wrapper мержить worktree; `failed` → агент отримує зауваження і доробляє; `needs-clarification` → агент пише `amended_NNN.md` |
| `## Reasoning` | обов'язковий; чіткий зв'язок із критерієм `## Done when`                                                                                  |

---

#### `amended_NNN.md`

Immutable. NNN = NNN відповідного `audit-result_NNN.md` (needs-clarification). Пишеться агентом у відповідь на `needs-clarification`. Містить відповідь на зауваження аудитора, уточнення, виправлення. Дозволяється лише 1 раз: якщо після `amended_NNN.md` аудит знову `needs-clarification` → treat as `rejected` → новий run.

```markdown
---
schema_version: 1
created_at: ISO8601
audit_ref: audit-result_NNN.md
---

## Response

Відповідь на зауваження аудитора.
```

---

#### `run_summary.md`

Пишеться аудитором після N (дефолт: 5) поспіль failed спроб. Вміст: стислий аналіз всіх попередніх `run_*.md` — що пробували, що не вийшло, ключові висновки. Оркестратор при наступних запусках передає `run_summary.md` у context замість всіх `run_*.md` — збереження context window.

```markdown
---
schema_version: 1
created_at: ISO8601
actor: auditor
runs_analyzed: 5
---

## Summary

Стислий аналіз що пробували, що не вийшло.
```

---

#### `history/` — аудит-архів вузла

`history/` — вкладена директорія у вузлі для зберігання архівних артефактів. **Не є дочірнім вузлом** — не містить `task.md`, тому scan ігнорує.

```
mt/<task>/
  history/                    ← аудит-архів вузла (немає task.md → не вузол)
    <ts>-invalidate/          ← архів після mt invalidate
      fact_001.md
      run_001.md
      audit-result_003.md

<tasks-root>/
  .history/                   ← архів видалених вузлів (після mt kill)
    <ts>-kill-<path>/
      task.md
      fact_001.md
      ...
```

`history/` не має `task.md` → scan не плутає з дочірніми вузлами. `<tasks-root>/.history/` — глобальний архів kill-операцій на рівні tasks root.

---

## Стани вузла

Стан вузла — **derived**: durable lifecycle визначається артефактами вузла, а runtime ownership — remote claim ref.
Стан не записується окремим mutable полем.

| Умова                                                        | Стан            |
| ------------------------------------------------------------ | --------------- |
| `task.md` є, немає `a.md`/`h.md`                             | `unassigned`    |
| `h.md` є, немає `fact_*`, немає active claim                 | `pending`       |
| `a.md` є, deps resolved, немає active claim, немає `fact_*`  | `waiting`       |
| `a.md` є, deps НЕ resolved                                   | `blocked`       |
| active claim існує і `lease_until > now()`                   | `running`       |
| claim існує, lease expired, renewal/takeover ще не завершено | `stalled`       |
| `pending-audit_N` є, `audit-result_N` немає                  | `pending-audit` |
| `fact_*.md` є                                                | `resolved`      |
| `run_*.md` є, `fact_*.md` немає, active claim немає          | `failed`        |

Пріоритет: `resolved` > `pending-audit` > `stalled` > `running` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`

Семантика станів очікування:

- `a.md`/`h.md` = **хто** виконує (агент або людина)
- Стан `waiting` = a.md є, deps resolved — runner: немає `plan_*.md` → `mt plan`; є `plan_*.md` → `mt run`
- Стан `pending` = h.md є — runner завжди пропускає; людина сама вирішує

Примітки:

- `blocked` → тільки для `a.md` (deps не resolved)
- `failed` → найнижчий пріоритет, пасивний

`unassigned` — `task.md` є але не призначено виконавця. Оркестратор пропускає. Watch нагадує (TODO: Telegram) якщо вузол у `unassigned` > `stale_worktree_min` хвилин.

`pending` — `h.md` присутній (з планом або без). Runner завжди пропускає; watch виводить нагадування + notify email з `h.md` (Telegram TODO). Людина сама вирішує: `mt plan` якщо потрібен план, або `mt run --actor human` якщо план вже є.

`waiting` — `a.md` є, deps resolved. Runner: немає `plan_*.md` → auto `mt plan`; є `plan_*.md` → auto `mt run`.

`blocked` — тільки для `a.md`; deps satisfaction перевіряється при `mt scan` (batch). Відображається в `mt status` як `[blocked: <dep-id>]`. Якщо dep-вузол не має `fact_*.md` → `blocked-invalid-dep`, skip.

`stalled` — claim branch існує, але `lease_until + claim_grace_sec ≤ now()`. Локальний runner додатково може
перевірити `kill -0 <pid>` за runtime marker, але remote runner не покладається на чужий PID.

Takeover дозволений лише після expiry + grace і виконується CAS-update від exact поточного claim SHA. Старий runner
після takeover втрачає fencing token і не може publish результат.

Пріоритет перевірки: `resolved` > `pending-audit` > `stalled` > `running` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`.

**Deps check — batch scan, не per-node:** Список залежностей = `ls -R mt/<task>/deps/` → шляхи → обрізати `.md` → dep-id. Deps satisfaction — обчислюється в пам'яті при `mt scan` (один раз за цикл, будує граф). Без читання вмісту файлів.

**Composite вузол** (є хоча б одна дочірня директорія з `task.md`):

Стан composite вузла визначається так само як атомарного: `fact_*.md` є → `resolved`. O(1) — без рекурсивного сканування дітей.

**Composite `fact_NNN.md`** пише **wrapper** (не агент) — тригер: `mt done <child>` після успішного merge:

```
parent = mt/<child>/..
якщо всі children мають fact_*.md:
  → пише mt/<parent>/fact_NNN.md (NNN = count(існуючих fact_*.md) + 1)
  → ## Summary = агрегація ## Summary всіх дочірніх вузлів
  → рекурсивно перевіряє батька батька (propagation вгору)
```

Один merge може закрити весь ланцюг composite вузлів вгору. Уніфікована перевірка: будь-який `fact_*.md` → resolved (атомарні і composite — однаковий механізм).

### Видимість станів у статусі

```
graph — waiting:2 pending:1 running:1 blocked:2 [slots: 1/5]

  👤 design-api         [pending: h.md — run: mt run mt/design-api/ --actor human]
  ○ implement          [blocked: design-api]
  ○ deploy             [blocked: implement]
  ◉ collect-data       [running]
  ○ analyze            [waiting]
  ✓ prepare-data       [resolved]
```

---

## CLI контракт (`mt`)

Конфіг: `MT_DIR` env або `.mt.json` → поле `mt_dir`, дефолт `./mt/`.

Всі команди підтримують `--json` для machine-readable виводу.

### Список команд

```
mt
  setup                              ← ініціалізація проєкту
  init <name> [--task "..."]         ← створити task.md (unassigned; потім додати a.md або h.md)
  plan [<path>] [--mode agent]       ← Stage 1: spec + decompose → plan_NNN.md або spawn
  status [<path>] [--json]           ← стан графу
  scan [--json]                      ← повне сканування + exit 1 якщо є failed
  run [<path>] [--actor a] [--auto]  ← запустити вузол або оркестратор
  kill <path> [--no-cascade]         ← archive + git rm вузла і нащадків; SIGTERM живих процесів
  invalidate <path>                  ← архівує fact_*/run_* у history/; cascade вниз по нащадках
  # сигнали агента:
  done <path>                        ← успіх → merge
  audit <path>                       ← хоче аудит → pending-audit_NNN.md
                                       (NNN = NNN останнього fact_NNN.md; auto-detected)
                                       ВИМАГАЄ наявного fact_NNN.md; помилка якщо відсутній
  failed <path>                      ← провал
  spawn <path> --mode agent|human [--approve]  ← composite → зареєструвати дочірні (--mode обов'язковий)
                                                 --approve: схвалити plan-review (plan_NNN.md)
                                                 --reject: відхилити plan-review

mt watch                       ← periodic rescan: черга аудиту + попередження (TODO: daemon + Telegram)
```

### Опис команд

```
mt setup
```

- Ініціалізує проект: `.mt.json`, `.mt/system-prompt.md`, `.mt/engineer-prompt.md`, `mt/`
- Встановлює git `post-merge` hook

```
mt init <name> [--task "..."] [--budget-sec N] [--mode agent|human]
```

- Генерує `mt/<name>/task.md` через LLM на основі опису `--task` + `a.md` (якщо `--mode agent`) або залишає `unassigned`
- `--mode agent|human` — strongly recommended; без нього → CLI warning + вузол у стані `unassigned` (не пише `a.md`/`h.md`)
- `budget_sec` з `--budget-sec` або `default_budget_sec` конфігу
- Без `--mode` → читає `default_mode` з конфігу (дефолт: `agent`), пише відповідний `a.md`/`h.md` автоматично
- Людина доповнює `## Inputs` і `## Done when` вручну; може додати `a.md` або `h.md` для перевизначення

```
mt plan [<path>] [--mode agent]
```

- Stage 1: spec + decompose; planning temperature: `plan_temperature` з конфігу (дефолт: `0`)
- `mode` з прапорів: `h.md` = human, `a.md` = agent; `--mode agent` — перевизначає (видаляє `h.md`, створює `a.md`)
- `h.md` — IDE-діалог; `a.md` — автономний
- Вихід atomic: `plan_NNN.md` (decision: atomic) → `touch .mt/wake` → watch підхоплює на наступному скані (≤5 хв) → `mt run --auto`
- Вихід composite: `plan_NNN.md` (decision: composite) → стан `plan-review`. Дочірні вузли НЕ створюються до `mt spawn --approve`. `mt spawn --approve` → дочірні `<child>/task.md` + `<child>/<mode>.md` + `deps/` → `mt run --auto` підхоплює дітей
- **Composite planning — агент пише a.md/h.md для дітей:** при composite `mt plan` агент пише `a.md` або `h.md` для **кожного** дочірнього вузла. `a.md` містить `model_tier` і `skills` визначені агентом індивідуально. Агент може написати `h.md` якщо підзавдання потребує людини. Після spawn: жодних `unassigned` дітей. Батько `h.md` → дочірні отримують `unassigned`, людина вирішує mode через `mt init child --mode`.

```
mt status [path] [--json]
```

- без `path` → весь граф від `mt/`
- з `path` → вузол і нащадки
- виводить: state, останній `run_NNN`, активний worktree, `[slots: X/agent_concurrency]`; `pending` — з підказкою команди
- exit: `0` ok | `1` вузол не знайдено

```
mt run [<path>] [--actor agent|engineer|human|auditor] [--auto]
```

- **З `path`**: один вузол — перевірка deps → atomic remote claim → worktree → агент → timeout → `run_NNN.md` → publish
- **`--auto` / без `path`**: one-shot оркестратор — знаходить всі `waiting` вузли з `a.md`; немає плану → auto `mt plan`; є план → auto `mt run`; кожен запуск спочатку CAS-claim-ить remote branch; `pending` (h.md) і `unassigned` — пропускає
- **`--actor auditor`**: wrapper аудитора — spawns auditor subprocess, чекає, читає `audit-result_NNN.md`, success → merge
- **`--actor human`**: claim-ить вузол, створює run ref/worktree і запускає lightweight lease renewer; людина працює вручну та викликає `mt done|audit|failed`; якщо renewer зупинився, ownership діє лише до `human_claim_lease_sec`
- **дефолтний `--actor`**: `a.md` → agent; `h.md` → human
- exit: `0` всі resolved | `1` є failed | `2` timeout | `3` system error

```
mt kill <path>
```

- Cascade завжди повний; `--no-cascade` — escape hatch для примусового одиночного kill.
- Послідовність:
  1. Читає remote claim і перевіряє ownership token; для чужого активного claim потрібен явний `--force`
  2. SIGTERM процесу, якщо claim належить локальному host і PID живий
  3. CAS-видаляє claim ref лише з exact expected claim SHA
  4. `git worktree remove --force <worktree>` якщо є
  5. Архівує весь вузол і нащадків: `<tasks-root>/.history/<ts>-kill-<node-path>/`
  6. `git rm -r mt/<path>/` + `git commit "mt: kill mt/<path>"`
- Вимагає clean working tree. При незакомічених змінах → error: "commit or stash changes before mt kill".
- **Undo kill** = `git revert <kill-commit>` відновлює весь піддерево.
- exit: `0` all killed | `1` часткова помилка

```
mt invalidate <path>
```

- Архівує `fact_*.md`, `run_*.md` → `mt/<node>/history/<ts>-invalidate/`
- `task.md`, `a.md`/`h.md`, `deps/` залишаються; `plan_*.md` — якщо є, вузол повертається до `waiting`
- Cascade вниз по нащадках (кожен отримує `mt invalidate` рекурсивно)
- Не пише `invalidated` sentinel — стан derived автоматично з відсутності `fact_*.md`

```
mt scan [--json]
```

- Сканує всі `task.md`, реконструює DAG через `deps/`, виводить стан кожного вузла
- exit: `0` граф чистий | `1` є вузли у стані `failed`

---

## Вузол як агент

Кожен вузол — це запуск Claude. Оркестратор передає протокол через `system_prompt`; файли вузла — лише місія та дані.

**Запуск:**

```
Claude(
  system_prompt = <протокол оркестратора>,
  context       = [task.md] + [a.md|h.md] + [deps/] + [plan_*.md] + [Prior attempts резюме (якщо є failed runs)] + [audit-result_*.md]
)
```

> **Prior attempts резюме:** Агент отримує компактне **Prior attempts** резюме замість повних `run_NNN.md`. Wrapper витягує з усіх failed runs три секції: `## Completed`, `## Blockers`, `## Next Attempt`. Склеює у резюме фіксованого розміру незалежно від кількості спроб.
>
> `## Completed`, `## Blockers`, `## Next Attempt` — **обов'язкові** при `result: failed`.
> При `result: success` — `## Completed` + `## Summary` (для composite агрегації).
>
> Повні `run_NNN.md` залишаються у директорії для людського аудиту.
>
> **Примітка:** Wrapper генерує `run-summary.md` через LLM (audit_model tier) якщо є 2+ failed `run_NNN.md`. Це transient file — видаляється при `mt kill`.

**System prompt оркестратора** (агент ніколи не бачить у своїх файлах):

```
Твій файл місії: task.md. Режим виконання: a.md (агент) або h.md (людина). Залежності у deps/.

Крок 1 — якщо plan_NNN.md ще немає: виклич mt plan <шлях>
  → atomic:    план готовий → переходь до роботи
  → composite: ти вже створив дочірні task.md + a.md|h.md + deps/ → виклич mt spawn → завершуй

Крок 2 — є plan_NNN.md (decision: atomic): виконай роботу, потім:
  → впевнений:         запиши fact_NNN.md (NNN із ENV MT_RUN_NNN)
                       виклич: mt done <шлях>   ← wrapper запише run_NNN.md (success)
  → потрібна перевірка: запиши fact_NNN.md (NNN із ENV MT_RUN_NNN)
                       виклич: mt audit <шлях>  ← wrapper запише run_NNN.md (success)
  → помилка:           НЕ пиши fact_NNN.md
                       виклич: mt failed <шлях> ← wrapper запише run_NNN.md (failed)
```

**Агент може читати файли будь-яких вузлів** (батька, братів, дочірніх) без обмежень.

**Всі агенти запускаються через wrapper-скрипт** — відстежує таймаут і може кілити процес.

---

## Два етапи виконання вузла

**Етап 1 — `mt plan`**

```
--mode human   # інтерактивний діалог з людиною
--mode agent   # автономно, без участі людини (default якщо є a.md)
```

Вихід:

- **Atomic** → `plan_NNN.md` (decision: atomic) → Етап 2
- **Composite** → `plan_NNN.md` (decision: composite) → стан `plan-review` → `mt spawn --approve` → дочірні вузли → `mt spawn`

### Етап 2 — Execution

```
агент виконує роботу (спираючись на plan_NNN.md)
→ пише fact_NNN.md
→ mt done   ← впевнений → merge
→ mt audit  ← хоче зовнішню перевірку → pending-audit_NNN.md → черга
→ mt failed ← задача невирішувана
```

---

## Оркестрація

**`mt run --auto`** (one-shot, тригерується post-merge hook) і **`mt watch`** (periodic rescan) — обидва шукають
`waiting` вузли з `a.md`. Координація відбувається через GitHub custom claim refs
`refs/mt/claims/<node-hash>`. Перший CAS-push отримує ownership; усі інші runner отримують rejected push і
пропускають вузол.

```
merge → post-merge hook:
    mt run --auto   (one-shot)
    touch .mt/wake

mt watch (periodic, кожні 5 хв або по wake):
  → сканує граф знизу вверх
  → waiting вузли з a.md → немає плану: auto mt plan; є план: auto mt run
      0a. Рахує active agent claims, де `lease_until + claim_grace_sec > now()` → якщо `count ≥ agent_concurrency` → skip до наступного тіку
      0b. Перевіряє: вільне місце на диску >= min_free_disk_gb → якщо ні: Telegram алерт + skip
      0c. `--auto` сортує `waiting` вузли: leaf nodes першими (розблоковують залежні), потім за nearest deadline → якщо `running_count ≥ agent_concurrency` → skip решту до наступного тіку
      CAS-create refs/mt/claims/<node-hash>
        rejected → skip: вузол уже має active claim
        accepted → mt run --actor agent (при відсутності plan_*.md → auto-планує перед run)
  → pending вузли з h.md →
      повідомляє людину (TODO: Telegram); runner пропускає
  → pending-audit_NNN.md без audit-result_NNN.md →
      mt run --actor auditor
  → plan-review вузли → пропускає (чекають approve)
```

```
waiting + a.md (немає плану)  →  auto: mt plan
waiting + a.md (є план)       →  auto: mt run
pending + h.md                →  skip + notify людину
```

**`unassigned`** (немає `a.md`/`h.md`): runner пропускає; watch нагадує (TODO: Telegram).

**`waiting`** + `a.md`: watch запускає `mt plan` (немає плану) або `mt run` (є план) автономно.

**`pending`** + `h.md`: watch виводить нагадування + notify.

**`pending`** + `h.md`: watch виводить нагадування + notify email. Runner пропускає.

**`pending`** (h.md): watch виводить нагадування + notify email з `h.md`. Runner пропускає.

**`plan-review`** вузли (composite з `plan_NNN.md` але без `approved` sentinel) — watch пропускає. Людина викликає `mt spawn --approve <path>` або `mt spawn --reject <path>`.

**Orphan worktree/run ref:** watch знаходить expired claim і відповідний `run_ref`. Новий owner може або
продовжити цей run після явної перевірки, або залишити ref для debug і створити новий run. Наявність orphan
worktree сама по собі ніколи не дає права publish.

**EngineerAgent:** watch при скані знаходить вузол у стані `failed` → запускає `mt run <path> --actor engineer`.

---

## Аудит (async черга)

Якісний гейт на вимогу агента або людини. Іде через файлову чергу — не синхронно.

### Потік

```
агент/людина:
  → пише fact_NNN.md                          ← ОБОВ'ЯЗКОВО перед audit
  → mt audit <path>
      wrapper: перевіряє наявність fact_NNN.md → помилка якщо відсутній
      wrapper: створює pending-audit_NNN.md (NNN = NNN fact_NNN.md)
      wrapper: fenced publish → видалити worktree   ← pending-audit_NNN.md тепер у main

mt watch:
  → знаходить pending-audit_NNN.md без audit-result_NNN.md у main
  → mt run --actor auditor <path>
      wrapper: claim + audit run branch від main (читає fact_NNN.md + pending-audit_NNN.md + amended_NNN.md якщо є)
        auditor → пише audit-result_NNN.md (NNN = NNN pending-audit)
        success → fenced publish + delete auditor worktree + touch .mt/wake
                  → для composite: wrapper пише fact_NNN.md у батьківський вузол
        failed  → fenced publish audit-result → agent стартує новий worktree → бачить зауваження:
            fact_(N+1).md → mt audit → pending-audit_(N+1).md → черга знову
        needs-clarification → merge audit-result →
            agent пише amended_NNN.md у директорію вузла (NNN = NNN audit-result)
            watch виявляє: pending-audit_NNN.md + audit-result_NNN.md(needs-clarif) + amended_NNN.md
                → mt run --actor auditor (повторний)
                    аудитор читає fact_NNN.md + amended_NNN.md → перезаписує audit-result_NNN.md
                    якщо знову needs-clarification → treat as failed → новий run (amended лише 1 раз)

  → рахує run_*.md без fact_*.md: якщо ≥ run_summary_threshold (дефолт: 5) →
      auditor пише run_summary.md (аналіз всіх run_NNN.md)
      оркестратор при наступних запусках передає run_summary.md замість всіх run_NNN.md
```

**Ліміт циклів:** після 3 поспіль `audit-result_*.md (result: failed)` — watch ескалює (TODO: через Telegram).

**run_summary.md:** після `run_summary_threshold` (дефолт: 5) поспіль failed спроб — аудитор пише `run_summary.md`. Оркестратор передає його в context замість всіх `run_NNN.md` — збереження context window.

Аудитор може використовувати дешевшу модель: `audit_model` у `.mt.json` або per-node у `.mt-override.json`.

---

## Wrapper-скрипт

**Звичайний запуск** (`mt run <path> [--actor agent|engineer|human]`):

1. Читає `task.md` → `budget_sec`, `budget_hard_sec`, `interactive`; читає `a.md`/`h.md` → mode, `model_tier`, `skills`/`qualification`.
2. `ls -R deps/` → список dep-id (strip `.md`); перевіряє що всі deps мають `fact_*.md` → `resolved`; якщо dep не має `fact_*.md` → стан `blocked-invalid-dep`, exit з помилкою.
3. Перевіряє: є `pending-audit_*.md` без відповідного `audit-result_*.md` → **exit з помилкою** "audit pending, retry blocked".
4. Виконує `git fetch origin main` і atomic claim acquisition:
   - claim відсутній → create-only CAS push;
   - active claim існує → skip;
   - expired claim → takeover лише після grace через exact-SHA CAS.
5. Після accepted claim створює detached worktree від зафіксованого `base_sha`, а не checkout `main`:

   ```bash
   git worktree add \
     --detach \
     .worktrees/<node-hash>-<token> \
     <base_sha>

   git push origin \
     HEAD:refs/mt/runs/<node-hash>/<token>
   ```

   Remote run ref потрібен для recovery/handoff між server і personal computer. Він не є ownership lock.

6. Пише локальний `running_<pid>_until_<lease_until>` marker і запускає lease renewal кожні
   `claim_renew_sec`. Renewal створює новий claim commit з parent = current claim SHA і оновлює ref через CAS.
   Wrapper після кожного checkpoint commit CAS-оновлює run ref; uncommitted зміни залишаються лише локальними й не
   доступні для remote recovery.
7. Визначає NNN = `count(run_*.md) + 1`.
8. Запускає агента (cwd = worktree) з ENV:

   ```
   MT_BUDGET_SEC=<sec> MT_HARD_BUDGET_SEC=<sec|0> \
   MT_STARTED_AT=<unix> MT_RUN_NNN=<NNN> \
   MT_CLAIM_TOKEN=<token> MT_CLAIM_GENERATION=<generation> \
   claude --system-prompt .mt/system-prompt.md \
          --message "solve task at task.md"
   ```

   Агент сам обчислює залишок: `remaining = started_at + budget_sec - now()`

9. Поллінгує worktree кожні 5 сек:
   - жодних змін `mtime` > `progress_timeout_sec` → SIGKILL + `result: progress-timeout`
   - elapsed > `budget_hard_sec` (якщо > 0) → SIGKILL + `result: budget-exceeded`
   - renewal rejected або current claim token змінився → SIGTERM + `result: claim-lost`; publish заборонено
10. Після виходу агента:

- є `fact_NNN.md` (агент записав) → пише `run_NNN.md` з `result: success` + `## Ref → fact_NNN.md`
- інакше → пише `run_NNN.md` з `result: failed`; агент мав писати `## Reasoning` + `## Partial Work`

11. `result: success` → **fenced publish protocol** → видаляє local marker/worktree → `touch .mt/wake`.
12. `result: failed`, timeout або claim-lost → run ref/worktree лишається для debug; claim звільняється CAS-delete,
    лише якщо runner досі ним володіє.

**Запуск аудитора** (`mt run --actor auditor <path>`):

1. Перевіряє наявність `pending-audit_NNN.md` без `audit-result_NNN.md` у main
2. Claim-ить audit operation тим самим CAS-протоколом і створює окремий audit run ref від `base_sha`
   (pending-audit_NNN.md і fact_NNN.md вже в main після merge агента)
3. Spawns auditor subprocess у цьому worktree
4. Чекає виходу → аудитор пише `audit-result_NNN.md`
5. Читає `result`:
   - `success` → **fenced publish protocol** → `touch .mt/wake`
   - `failed` → рахує існуючі `audit-result_*.md (result: failed)` у main:
     - < 3 → **fenced publish protocol** → agent стартує новий worktree, бачить `audit-result_NNN.md`
     - ≥ 3 → worktree залишається, watch ескалює через Telegram

**Fenced publish protocol** (використовується скрізь — агент і аудитор):

```bash
# 1. Оновити результат від актуального origin/main.
git fetch origin main
git fetch origin refs/mt/claims/<node-hash>
git -C <worktree> rebase origin/main

# 2. Перевірити, що claim ref досі має exact SHA/token цього runner.
# 3. Одним atomic push:
#    - fast-forward/CAS оновити main;
#    - CAS-видалити claim;
#    - видалити remote run ref.
git push --atomic \
  --force-with-lease=refs/heads/main:<expected-main-sha> \
  --force-with-lease=refs/mt/claims/<node-hash>:<claim-sha> \
  --force-with-lease=refs/mt/runs/<node-hash>/<token>:<run-sha-before-publish> \
  origin \
  <result-sha>:refs/heads/main \
  :refs/mt/claims/<node-hash> \
  :refs/mt/runs/<node-hash>/<token>
```

Якщо `main` або claim змінився, push відхиляється без часткового застосування. Runner повторює fetch + rebase, але
продовжує лише якщо claim token досі його. Максимум 3 спроби; далі worktree/run ref лишаються для debug.

MT при setup перевіряє, що remote рекламує atomic push capability. Якщо capability відсутня, direct publish
**fail closed**; fallback — integration bot/PR, який є єдиним writer у `main` і перед merge перевіряє current claim.

Для protected `main` runner не отримує bypass. Він створює integration branch із commit, на який вказує run ref,
і відкриває PR із claim token у metadata.
Integration bot перевіряє exact claim SHA/token, merge-ить PR і лише після успішного merge CAS-видаляє claim.

Protocol гарантує mutual exclusion лише для compliant MT runners. Щоб fencing було security boundary, прямий push
людей/агентів у `main` забороняється branch protection; єдиний writer — fenced direct-publish identity або integration bot.

**Конфлікти можливі:** агенти можуть змінювати shared project files, тому rebase/merge може конфліктувати.
Конфлікт → `result: failed (merge-conflict)`; claim не передається іншому runner до cleanup або expiry.

**Git hook** (`.git/hooks/post-merge`):

```bash
#!/bin/sh
mt run --auto
touch .mt/wake
```

---

## `mt watch`

**Поточна реалізація:** простий periodic rescan раз на 5 хвилин (або по `touch .mt/wake`). Не persistent daemon.

```bash
mt watch   # запускає один scan-цикл; cron або loop-скрипт викликає кожні 5 хв
```

**При кожному скані:**

- `git ls-remote origin 'refs/mt/claims/*'` → будує authoritative список active/stalled claims
- Для локальних claims додатково перевіряє `kill -0 <pid>`; мертвий local process не звільняє claim без CAS-delete
- Знаходить expired claims (`lease_until + claim_grace_sec ≤ now()`) → виводить попередження або запускає CAS-takeover
- Знаходить `pending-audit_NNN.md` без `audit-result_NNN.md` → `mt run --actor auditor`
- Знаходить `failed` вузли (без активного процесу) → `mt run <path> --actor engineer`
- Знаходить orphan run refs без active claim → пропонує explicit resume або cleanup; автоматичний publish заборонено
- Composite вузол: `mt done <child>` wrapper перевіряє чи всі siblings resolved → якщо так, пише `fact_NNN.md` батька автоматично (без окремого watch-кроку)
- Знаходить `pending` (h.md) вузли → виводить нагадування + notify email з `h.md` (Telegram TODO)
- Знаходить `unassigned` (немає a.md/h.md) → виводить нагадування (TODO: Telegram)
- Знаходить `plan-review` вузли → пропускає (чекають approve від людини)

**TODO (майбутній daemon):**

| Умова                                                                     | Повідомлення                          |
| ------------------------------------------------------------------------- | ------------------------------------- |
| `pending` (h.md) вузол > `stale_worktree_min` хв                          | потрібна участь людини                |
| ≥ 3 поспіль `audit-result_*.md (result: failed)`                          | audit loop — потрібна людина          |
| `actor: engineer, result: failed` на кореневому рівні                     | engineer budget exhausted             |
| `stalled` вузол (claim lease + grace минули, renewal відсутній)           | claim прострочено — потрібен takeover |
| граф blocked (всі remaining: `unassigned`/`pending`+h.md або failed-deps) | граф заблокований                     |
| вільне місце на диску < `min_free_disk_gb`                                | disk space alert                      |

Конфіг: `stale_worktree_min` у `.mt.json` (дефолт `30`).

exit: `0` проблем немає | `1` є вузли що потребують уваги

---

## Протокол spawn (розкладання вузла на підграф)

Агент вирішує "composite" в Stage 1 (`mt plan`). **Структуру підграфу визначає виключно агент** — оркестратор не втручається.

**`mt spawn` вимагає `--mode agent|human`** — обов'язковий параметр. Без нього → validation error. Агент при composite плані зобов'язаний вказати `--mode` для кожного дочірнього вузла.

```
mt plan <path> → decision: composite → стан plan-review:
  → людина: mt spawn --approve <path> --mode agent|human
      1. для кожного дочірнього (з plan_NNN.md ## Approach):
         mkdir <node-id>/
         пише <node-id>/task.md                    ← місія
         touch <node-id>/a.md або h.md             ← sentinel mode (відповідно до --mode)
         пише <node-id>/deps/<dep-node-id>.md      ← по одному на кожну залежність (тільки siblings)
      2. пише approved sentinel
  → або: mt spawn --reject <path> → видаляє plan_NNN.md → повернення до plan
```

**Cross-level deps при spawn:** `deps/` підтримує вкладену структуру — сусіди (`deps/sibling.md`) або крос-рівневі (`deps/other-branch/node.md`). Оркестратор визначає dep-id через `ls -R deps/` + strip `.md`.

**Динамічний spawn** (новий вузол під час виконання):

```
агент (будь-коли в Stage 2) →
  mkdir <new-node-id>/
  пише <new-node-id>/task.md + a.md/h.md           ← місія + mode
  пише <new-node-id>/deps/<dep-node-id>.md          ← по одному (тільки siblings)
  mt spawn <шлях-вузла> --mode agent|human       ← --mode обов'язковий
```

Новий вузол підхоплюється оркестратором при наступному скануванні.

---

## Протокол патчу вузла що вже має залежних

Перед тим як патчити `collect-data` (вже resolved) — інженер зобов'язаний:

```
1. знайти всі running worktrees наступників:
   collect-data → analyze (running) → synthesize (running)
2. kill від листів до цілі (топологічний порядок):
   mt kill synthesize   (process + worktree + cascade invalidate)
   mt kill analyze
3. застосувати патч до collect-data у власному worktree
4. fenced publish worktree
5. restart каскаду від collect-data
```

Інженер пише `run_NNN.md` (actor: engineer) з `## Reasoning` — єдиний запис наміру і результату.

---

## Паралельне виконання: ворктрі

Незалежні вузли ОАГ виконуються паралельно — кожен агент у своєму git worktree.

**Remote publish = межа атомарності.** Наступник стартує лише після успішного publish попередника у `main`.

**Кожен патч інженера — у своєму worktree.** Видаляється після завершення.

### Щасливий шлях

Незалежні вузли пишуть у різні директорії — merge чисте, без конфліктів.

### Конфлікт при злитті

```
wrapper: git merge → конфлікт → result: failed (merge-conflict)
                   → worktree залишається для debug
                   → watch: EngineerAgent вирішує як звичайний failed вузол
```

Конфлікт злиття = звичайний `failed`. Той самий патерн відновлення що і при будь-якій іншій помилці.

### Ліміти worktree

`agent_concurrency` у конфізі — ліміт active agent claims, а не локальних директорій. Людські claims (h.md) не
рахуються. `warn_worktrees_above` — локальний поріг попередження. Черга очікування якщо global claim limit вичерпано.

---

## Самовідновлення: агент-інженер

Інженер — **мета-рівень поза графом**, без власного стану. Викликається при `стан = failed`.

```
EngineerAgent(run_NNN.md, full_path_from_root) →
  GraphPatch:
    ├── замінити вузол (atomic → composite або навпаки)
    ├── вставити вузли (додати проміжні кроки)
    ├── перепідключити ребра
    └── змінити вхідні дані
```

Може змінювати **будь-який рівень** — від вузла що впав до кореня.

### Перевірка попередника перед стартом

```
predecessor/fact_*.md існує
  → можна стартувати
  → інакше (fact_*.md відсутній або вузол у waiting) — очікувати
```

### Каскад інвалідації

```
patch(analyze) →
  mt invalidate analyze →
    архівує analyze/fact_*.md → analyze повертається у waiting
    каскад: mt invalidate synthesize, report → архівує їх fact_*.md → ...
```

`mt kill` — завжди cascade: видаляє вузол і весь downstream через `git rm -r` + архів у `.history/`.

**Differential cascade при re-run після invalidate:** `mt done` порівнює hash нового `fact_NNN.md` з попереднім (поле `hash: sha256:<hash секції ## Result>`). Однаковий hash → залежні вузли залишаються `resolved` (їх `fact_*.md` не зачіпається). Різний hash → каскад `mt invalidate` продовжується вниз.

---

## Протокол агента-інженера

Інженер = той самий вузол, перезапущений з `--actor engineer`.

```
mt run <node-path> --actor engineer
```

1. Wrapper збирає контекст: task-файл + `deps/*.md` + всі `run_NNN.md` відсортовані за `created_at`
2. Запускає агента з `.mt/engineer-prompt.md` (окремий system prompt)
3. Агент читає контекст, визначає причину і план дій
4. Якщо потрібен патч залежного вузла:
   - `mt kill <dep-node>`
   - Створює worktree, вносить зміни в `dep-node/task.md` (+ `a.md`/`h.md`)
   - Мержить worktree
   - Перезапускає залежний вузол
5. Перезапускає себе якщо потрібно
6. Wrapper пише `run_NNN.md` з `actor: engineer`

Відмінності від звичайного агента: інший system prompt; увесь `run_NNN.md` history як контекст; дозволені `mt kill`, зміни через worktree.

---

## Збіжність: часовий бюджет

Замість ліміту спроб — **часовий бюджет**. Інженер адаптує стратегію до залишку:

- Багато часу — складна спроба
- Мало часу — швидке виправлення
- `залишок <= 0` — `стан = невирішуваний`, ескалація

---

## Ієрархія ескалації

Кожен рівень отримує **свіжий** часовий бюджет:

```
вузол впав
  → EngineerAgent (budget: 10хв)
      → timeout → ескалація
          → батько: EngineerAgent (свіжий budget: 10хв)
              → ...
                  → корінь: timeout
                      → mt watch репортить людині через Telegram
```

**Максимальний час до людини:** `глибина × бюджет`

---

## Конфігурація (`.mt.json`)

```json
{
  "mt_dir": "./tasks",
  "worktrees_dir": "./.worktrees",
  "git_remote": "origin",
  "claim_ref_prefix": "refs/mt/claims",
  "run_ref_prefix": "refs/mt/runs",
  "claim_lease_sec": 3600,
  "claim_renew_sec": 300,
  "human_claim_lease_sec": 86400,
  "human_claim_renew_sec": 1800,
  "claim_grace_sec": 60,
  "warn_worktrees_above": 4,
  "agent_concurrency": 5,
  "max_worktree_age": 14400,
  "min_free_disk_gb": 10,
  "default_budget_sec": 1800,
  "default_budget_hard_sec": 3600,
  "budget_hard_sec_multiplier": 3,
  "progress_timeout_sec": 300,
  "stderr_lines": 50,
  "default_mode": "agent",
  "default_model_tier": "AVG",
  "plan_temperature": 0,
  "run_summary_threshold": 5,
  "claude_model": "claude-sonnet-4-6",
  "audit_model": "claude-haiku-4-5-20251001",
  "model_map": {
    "MIM": "claude-haiku-4-5-20251001",
    "AVG": "claude-sonnet-4-6",
    "MAX": "claude-opus-4-8"
  },
  "stale_worktree_min": 30,
  "system_prompt": ".mt/system-prompt.md"
}
```

`agent_concurrency: 5` — ліміт паралельних **агентських active claims**. Людські claims (actor: human, h.md) не
рахуються. Watch перед spawn перевіряє remote claims, а не локальний список worktrees.

`claim_lease_sec` — строк ownership; `claim_renew_sec` має бути істотно меншим за lease; `claim_grace_sec` —
буфер перед takeover. Claim timestamps записуються в UTC, але correctness takeover додатково захищається exact-SHA CAS.

Для `actor: human` використовуються довші `human_claim_lease_sec` і `human_claim_renew_sec`. CLI показує
`runner_id`, `lease_until`, worktree і run ref, щоб інша машина або людина не почала той самий вузол випадково.

Кожен task-файл (`task.md` + `a.md`/`h.md`) може перевизначити `budget_sec` локально.

`budget_hard_sec: 0` заборонено — означає "використати global default" (`default_budget_hard_sec` з конфігу).

Per-node override: `mt/<node>/.mt-override.json`

```json
{
  "budget_sec": 7200,
  "audit_model": "claude-opus-4-8",
  "escalation_blacklist": ["pending-audit"]
}
```

---

## Bootstrap

```bash
# 1. Ініціалізація проекту (один раз)
mt setup
# → .mt.json, .mt/system-prompt.md, mt/
# → .git/hooks/post-merge встановлено

# 2. Запустити periodic scan (кожні 5 хв)
# cron: */5 * * * * mt watch
# або loop: while true; do mt watch; sleep 300; done

# 3. Створення кореневого вузла
mt init my-project \
  --task "Розробити API для обробки платежів" \
  --budget-sec 3600
# → mt/my-project/task.md  (unassigned — без a.md/h.md)
# Призначити виконавця: touch mt/my-project/h.md  (або a.md)

# 4. Людина доповнює ## Inputs і ## Done when в task.md

# 5. Stage 1: людина планує (mode: human)
mt plan mt/my-project/
# → plan_001.md

# 6. Запуск
mt run mt/my-project/
```

Кореневий task-файл — немає `parent:`. Кореневий вузол не має `deps/`.

---

## Монорепо: множинні `mt/` директорії

**Bun монорепо** з кількома workspace-ами може мати окремий `mt/` у кожному пакеті:

```
monorepo/
  mt/                     ← глобальний mt/ (cross-workspace завдання)
    .history/
  packages/
    api/
      mt/                 ← api-специфічні задачі
        .history/
    frontend/
      mt/
        .history/
  .worktrees/                ← завжди в git root (один для всіх workspace)
```

- `MT_DIR` — вказує на конкретний `mt/` для поточного контексту (env або CLI arg)
- Один `mt watch` на один `mt/` root — запускати окремий watch для кожного mt/
- Worktrees — завжди в `.worktrees/` відносно git root (спільні для всіх workspace)
- `mt setup` у workspace-піддиректорії ініціалізує локальний `mt/` без зміни кореневого

**Обмеження: `.gitignore`**

`mt/` **не може** знаходитись у директорії що є в `.gitignore`. Git не відстежує файли в `.gitignore`d-директоріях — стан вузлів, `fact_*.md`, `run_*.md` та інші артефакти будуть втрачені при клонуванні репо і не синхронізуватимуться між учасниками.

Скан воркспейсів (оркестратор, GUI, `mt watch`) **зобов'язаний пропускати `.gitignore`d-директорії** при рекурсивному пошуку `mt/`. Алгоритм: при кожному спуску — зчитувати `.gitignore` у поточній директорії, накопичувати паттерни, фільтрувати піддиректорії перед рекурсією. Прихованим директоріям (починаються з `.`) та стандартним артефактним директоріям (`node_modules`, `target`, `dist`, `build`) — skip завжди, незалежно від `.gitignore`.

---

## Контракт для моніторингу

Скрипт відновлює durable стан графу скануванням файлової структури, а runtime ownership — скануванням remote
claim refs:

```
git ls-remote origin 'refs/mt/claims/*'

для кожного mt/**/task.md:
  визначити durable стан (які файли існують поруч)
  зіставити node-hash з active/stalled claim
  визначити залежності (ls deps/ — назви файлів = dep-id)
  зібрати run_NNN.md, fact_NNN.md, plan_NNN.md, pending-audit_NNN.md, audit-result_NNN.md

вивести:
  - дерево вузлів зі станами
  - вузли у стані failed      (є run_*.md без fact_*.md і без активного worktree)
  - вузли у стані pending (h.md) або unassigned (немає a.md/h.md)
  - вузли у стані pending-audit (є pending-audit без audit-result)
  - active/stalled claims та їх runner_id
  - локальні worktrees і remote run refs
  - вузли у стані `waiting` (очікують виконання)
```

---

## SWOT-аналіз

### Сильні сторони

- **Інкапсуляція:** батько не знає що всередині — замінюваність без змін у батьківському графі
- **Файловий стан:** безкоштовна персистентність, відновлення після збоїв, повний аудит через git history
- **Immutable файли + numbered:** будь-який збій відновлюється скануванням `run_*.md` / `fact_*.md`
- **LLM-first формат:** `run_NNN.md` — інженер читає і продовжує природно
- **Git-backed ownership:** atomic CAS claim не дозволяє двом host одночасно володіти одним вузлом
- **Fenced publish:** runner без актуального claim token не може штатно опублікувати результат
- **Git-native паралельність:** worktree — вже знайомий інструмент
- **Симетрія:** конфлікт злиття = вузол що впав — той самий патерн відновлення
- **Часовий бюджет** замість лічильника — реалістичне обмеження
- **Audit-трек окремо:** `audit-result_NNN.md` не засмічує `run_NNN.md` виконавців

### Слабкі сторони

- **Scan без індексу:** при великих графах сканування всіх task-файлів і `deps/` — дорого
- **Drift намірів:** після N патчів оригінальна місія розмивається (частково вирішено незмінним `## Task`)
- **Merge conflict** вимагає ручного або engineer-втручання — same as будь-який failed вузол
- **Масштаб worktree:** жорсткий ліміт на MacBook обмежує реальну паралельність

### Можливості

- `run_NNN.md` накопичує знання — можна дистилювати в кращі промпти майбутніх агентів
- Git history = безкоштовний time-travel debugging всього графу
- Файлова система може бути розподіленою (NFS, S3) — горизонтальне масштабування
- Природна інтеграція з CI/CD через git hooks

### Загрози

- **Cascade при зміні кореня:** інженер інвалідує весь граф і не вкладається у бюджет — система стоїть
- **LLM недетермінізм:** той самий вузол розкладається по-різному при перезапуску — ускладнює debugging
- **Lease clock skew:** host із неправильним часом може передчасно вважати claim expired. Exact-SHA CAS не допускає
  двох owner одночасно, але може передати ownership раніше очікуваного; потрібні NTP і консервативний `claim_grace_sec`.

---

## Зведена таблиця рішень

| Аспект                         | Рішення                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Структура                      | Рекурсивний складений ОАГ                                                                                                                                                                             |
| Декомпозиція                   | Динамічна, тільки в Stage 1 (mt plan)                                                                                                                                                                 |
| Хто вирішує структуру підграфу | Тільки агент (LLM)                                                                                                                                                                                    |
| Ребра                          | Потік даних (виходи → входи); топологія у `deps/` кожного вузла                                                                                                                                       |
| Центральний файл графу         | Відсутній — оркестратор сканує `task.md` + `a.md`/`h.md` + `deps/`                                                                                                                                    |
| Формат файлів                  | Markdown + YAML-фронтматер                                                                                                                                                                            |
| Атрибути фронтматеру           | Англійські, snake_case                                                                                                                                                                                |
| Імена файлів і директорій      | Англійська (обробляються скриптами)                                                                                                                                                                   |
| Всі файли                      | Immutable — новий факт = новий файл (виняток: `running_<pid>_until_<ts>` — git-ignored ephemeral; `audit-result_NNN.md` — 1 перезапис при clarification)                                              |
| schema_version                 | Перше поле у всіх YAML-фронтматерах; поточна версія `1`; оркестратор відмовляє при невідомій версії                                                                                                   |
| deps/ naming                   | Файли з розширенням `.md`; `deps/` може бути вкладеною (дзеркалює `mt/`); dep-id = відносний шлях від `deps/` без `.md`; `ls -R deps/` → список dep-id                                                |
| Часовий бюджет                 | `budget_sec` (м'який, агент перевіряє через ENV) + `budget_hard_sec` (hard kill; 0=вимкнено)                                                                                                          |
| Бюджет уточнення               | `plan_NNN.md` може перекрити `budget_sec`/`budget_hard_sec`/`progress_timeout_sec`                                                                                                                    |
| Budget priority                | `plan_NNN.md` > `.mt-override.json` > task file > `.mt.json`                                                                                                                                          |
| ENV для агента                 | `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, `MT_RUN_NNN`, `MT_CLAIM_TOKEN`, `MT_CLAIM_GENERATION`                                                                                         |
| Progress watchdog              | `progress_timeout_sec`: kill якщо немає змін `mtime` у worktree N сек                                                                                                                                 |
| Execution claim                | GitHub custom ref `refs/mt/claims/<node-hash>`; create/renew/takeover/release лише через exact-SHA CAS                                                                                                |
| Run ref                        | `refs/mt/runs/<node-hash>/<token>` від claim `base_sha`; worktree detached і ніколи не checkout-ить `main`                                                                                            |
| Stall detection                | Claim існує та `lease_until + claim_grace_sec ≤ now()`                                                                                                                                                |
| Fencing                        | Publish дозволено лише owner актуального claim SHA/token/generation; claim-lost runner завершується без publish                                                                                       |
| Agent concurrency              | `agent_concurrency` — ліміт active agent claims (h.md не рахуються)                                                                                                                                   |
| Auditor worktree               | Окремий audit run ref від claim `base_sha`; той самий claim/fencing protocol                                                                                                                          |
| Актори виконавців              | `agent` \| `engineer` \| `human` — поле `actor` у `run_NNN.md`                                                                                                                                        |
| Актор аудиту                   | `auditor` — пише виключно `audit-result_NNN.md`                                                                                                                                                       |
| Нумерація                      | `run_NNN.md` (корінь, кожна спроба); якщо success → `fact_NNN.md` (той самий NNN); якщо `mt audit` → `pending-audit_NNN.md` (NNN fact) → `audit-result_NNN.md` (NNN pending)                          |
| NNN source                     | wrapper рахує `count(run_*.md) + 1` до старту; агент отримує через ENV `MT_RUN_NNN`                                                                                                                   |
| Plan artifact                  | `plan_NNN.md` (numbered, immutable; без `mode:` поля) — вихід Stage 1; секції: Context, Approach, Risks                                                                                               |
| Plan review                    | Composite план → стан `plan-review`; `mt spawn --approve` або `--reject`; без approve — без дочірніх                                                                                                  |
| Plan temperature               | `plan_temperature: 0` у конфізі для детермінованого планування                                                                                                                                        |
| Refs                           | `ref: path#section` відносно поточного файлу; без копій даних                                                                                                                                         |
| Стан вузла                     | Derived: durable lifecycle з артефактів вузла, runtime ownership з remote claim refs                                                                                                                  |
| Стани                          | `unassigned`, `pending`, `waiting`, `blocked`, `running`, `stalled`, `pending-audit`, `children-done`, `resolved`, `failed`                                                                           |
| Протокол агента                | System prompt оркестратора (не у файлах вузла)                                                                                                                                                        |
| Ізоляція агента                | Може читати файли будь-яких вузлів без обмежень                                                                                                                                                       |
| Відновлення після збою         | Сканування `run_*.md` — вузли без `fact_*.md` = failed                                                                                                                                                |
| Паралельність                  | Detached Git worktree + remote run ref; один active claim на вузол                                                                                                                                    |
| Атомарність                    | Fenced remote publish; наступник стартує лише після accepted update `main`                                                                                                                            |
| Злиття                         | Fetch + rebase + CAS/atomic push; конфлікт → `result: failed (merge-conflict)` → EngineerAgent                                                                                                        |
| Межа immutability              | До worktree — вільно; після — тільки нові файли                                                                                                                                                       |
| Патч залежного вузла           | Kill наступників (топологічний порядок), потім патч                                                                                                                                                   |
| Самовідновлення                | EngineerAgent — мета-рівень, необмежений доступ                                                                                                                                                       |
| Інвалідація                    | `mt invalidate`: архівує fact*\*/run*\* → history/; cascade вниз по нащадках. `mt kill`: archive + git rm вузла; `--no-cascade` — escape hatch                                                        |
| Deps blocked-invalid           | Якщо dep не має `fact_*.md` → стан `blocked-invalid-dep`; skip виконання                                                                                                                              |
| Збіжність                      | Часовий бюджет (не кількість спроб)                                                                                                                                                                   |
| Ескалація                      | Кожен рівень — свіжий budget; листок → батько → ... → корінь → Telegram                                                                                                                               |
| Composite resolved             | `fact_NNN.md` є (unified — той самий механізм що й атомарний); O(1) перевірка                                                                                                                         |
| Composite fact                 | `mt done <child>` → wrapper перевіряє чи всі siblings resolved → пише `fact_NNN.md` батька (NNN = count+1; Summary = агрегація дітей); рекурсивно вгору                                               |
| Аудит                          | Async черга: `mt audit` → `pending-audit_NNN.md`; watch dispatches `mt run --actor auditor`                                                                                                           |
| Audit clarification            | `needs-clarification` → агент пише `amended_NNN.md`; повторний аудит; лише 1 раз                                                                                                                      |
| Audit run_summary              | Після `run_summary_threshold` failed спроб → аудитор пише `run_summary.md`                                                                                                                            |
| Pending audit                  | NNN = NNN відповідного `fact_NNN.md`; оброблено якщо ∃ `audit-result_NNN.md`                                                                                                                          |
| Audit result                   | NNN = NNN відповідного `pending-audit`; окремий трек від `run_NNN.md`                                                                                                                                 |
| Audit ліміт                    | 3 failed cycles → watch ескалює через Telegram                                                                                                                                                        |
| Merge після аудиту             | `mt run --actor auditor`; success → fenced publish або protected-main integration bot                                                                                                                 |
| Orphan worktree                | Expired claim + run ref → explicit resume або debug; orphan ніколи не дає publish ownership                                                                                                           |
| Оркестратор                    | `mt run --auto` (one-shot, post-merge hook) + `mt watch` (periodic rescan, 5 хв)                                                                                                                      |
| Mutual exclusion               | Create-only claim push: перший accepted, concurrent runners отримують rejected non-fast-forward/CAS                                                                                                   |
| Default mode                   | `default_mode` у конфізі (дефолт: `agent`); `mt init` без `--mode` → пише `a.md`/`h.md` автоматично                                                                                                   |
| Actor/Mode                     | `a.md` = агент (model_tier, skills); `h.md` = людина (qualification); немає = `unassigned`. Стан `waiting` = a.md є, deps resolved (runner обирає plan або run); `pending` = h.md є, runner пропускає |
| Spawn --mode                   | `mt spawn --mode agent\|human` — обов'язковий; без нього → validation error                                                                                                                           |
| mode: human headless           | `--auto` і watch пропускають `h.md` (`pending`); людина запускає вручну через `mt run`                                                                                                                |
| Watch роль                     | Periodic rescan (5 хв): черга аудиту + попередження; TODO: daemon + Telegram                                                                                                                          |
| Executor assessment            | `a.md` = агент (`model_tier`, `skills`); `h.md` = людина (`qualification` TODO); немає = `unassigned`                                                                                                 |
| Model tiers                    | MIM→haiku, AVG→sonnet (default), MAX→opus; задається через `model_map` у конфізі                                                                                                                      |
| Disk check                     | `min_free_disk_gb` у конфізі; watch alertує і skip при нестачі місця                                                                                                                                  |
| plan_NNN.md нумерація          | merged/active → продовжується; mt kill → видаляє plan\_\*.md → reset до 001                                                                                                                           |
| Ліміти worktree                | `agent_concurrency` — global ліміт agent claims; `warn_worktrees_above` — локальний поріг; `min_free_disk_gb` для disk check                                                                          |
| history/ структура             | `mt/<node>/history/<ts>-invalidate/` — архів після invalidate; `<tasks-root>/.history/<ts>-kill-<path>/` — архів kill                                                                                 |
| Монорепо                       | Кожен workspace має свій `mt/`; `MT_DIR` env вказує поточний; один watch на mt/ root; worktrees спільні (git root)                                                                                    |
| Моніторинг                     | `mt scan` — durable стан із файлів + runtime ownership через `git ls-remote` claim refs                                                                                                               |
