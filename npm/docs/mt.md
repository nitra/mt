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
  ├── стан: unassigned | pending | waiting | blocked | plan-review | spawned | running | stalled | pending-audit | resolved | failed | unresolvable
  ├── вхідні:  Map<portId, Value>
  └── вихідні: Map<portId, Value>   ← заповнюється при resolved
```

Для батьківського вузла інтерфейс однаковий: він чекає `resolved` не знаючи що всередині (**інкапсуляція чорної скриньки**).

### Граф

- **ОАГ** — орієнтований, без циклів
- **Ребра** — потік даних: виходи одного вузла стають входами наступного
- **Вхідний вузол** — отримує вхідні дані батьківського складеного вузла
- **Вихідні вузли** — кілька; їх виходи зливаються у виходи батька через `## children` ref-експорт у батьківському fact
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
    plan-approved_NNN.md     ← plan-review: схвалено (NNN = NNN плану; пише mt spawn --approve)
    plan-rejected_NNN.md     ← plan-review: відхилено з причиною (NNN = NNN плану)
    running_<pid>_until_<ts> ← git-ignored; локальна observability, НЕ lock
    run-draft.md             ← git-ignored; чернетка агента (Completed/Blockers/Next Attempt) — джерело секцій run_NNN.md
    run-summary.md           ← mutable; LLM-аналіз патернів невдач після run_summary_threshold (пише wrapper)
    unresolvable.md          ← термінальний маркер: спроби вичерпано, чекає людину (пише watch)
    run_NNN.md               ← спроба виконавця: agent | engineer | human (аудитор НЕ пише)
    fact_NNN.md              ← успішний результат; NNN = NNN відповідного run_NNN.md
    pending-audit_NNN.md     ← запит аудиту; NNN = NNN відповідного fact_NNN.md
    audit-result_NNN.md      ← фінальний вердикт аудитора (окремий трек); NNN = NNN pending-audit_NNN.md
    clarification_NNN.md     ← запит уточнення від аудитора (НЕ вердикт); NNN = NNN pending-audit
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

**Immutable файли** (не змінюються після створення): `task.md`, `plan_NNN.md`, `plan-approved_NNN.md`, `plan-rejected_NNN.md`, `run_NNN.md`, `fact_NNN.md`, `pending-audit_NNN.md`, `clarification_NNN.md`, `amended_NNN.md`, `unresolvable.md`. Новий факт = новий файл.

**Мутабельні прапори** (НЕ immutable): `a.md`, `h.md`, `running_<pid>_until_*`, `run-draft.md`, `run-summary.md`.

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
| `clarification_NNN.md` | NNN = NNN відповідного `pending-audit_NNN.md` (запит аудитора)     |
| `amended_NNN.md`       | NNN = NNN відповідного `clarification_NNN.md` (відповідь агента)   |

`fact_NNN.md` може не існувати для певного NNN — "дірка" означає що спроба N завершилась з `result: failed`.

Watch перевіряє "чи оброблено" без читання файлів: `pending-audit_003.md` оброблено ↔ існує `audit-result_003.md`.

Zero-padded до 3 цифр: `001`, `002`, …

`plan_NNN.md` — окрема логіка:

- Worktree **merged** або робота **продовжується** в ньому → нумерація продовжується (`002`, `003`, …)
- `mt kill` видаляє вузол цілком (архів у `.history/`); вузол, відтворений згодом через `mt init`, починає з `plan_001.md`

Актуальний `plan_NNN.md` — файл з найбільшим номером. `plan-approved_NNN.md` / `plan-rejected_NNN.md` успадковують NNN відповідного плану; рішення стосується лише актуального плану.

---

### Схеми файлів

#### `task.md`

Тільки місія. **Immutable після `mt init`**. Не містить інформацію про виконавця — вона в `a.md`/`h.md`.

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:00:00Z
budget_sec: 600 # м'який ліміт — агент перевіряє через ENV
budget_hard_sec: 10800 # hard kill; відсутнє поле → budget_sec × budget_hard_sec_multiplier; 0 → validation error
budget_total_sec: 14400 # опціонально: сумарний ліміт chain (сума wall_sec); перевищення → unresolvable
progress_timeout_sec: 300 # kill якщо немає змін у worktree N сек (опціонально)
deadline: 2026-06-12T18:00:00Z # опціонально: SLA; сортування черги waiting (nearest first)
audit: optional # required | optional | off; default — audit_policy з .mt.json
hint: atomic # опціонально: atomic | composite — підказка агенту
parent: research/collect-data # відносно mt/; відсутній у кореневого
---

## Task

Що саме має виконати цей вузол.

## Done when

Чіткий критерій: що означає "resolved".

## Check

<!-- опціонально: машинна частина Done when; кожен непорожній рядок — shell-команда (мусить exit 0), # — коментар -->

bun test payments/
bun run lint

## Inputs

Контекст від батька або inline-дані (не залежності — ті у `deps/`).

### instruction

Обробити лише перші 50 результатів, ігнорувати дублікати.
```

| Поле / секція          | Обов'язкове | Примітка                                                                     |
| ---------------------- | ----------- | ---------------------------------------------------------------------------- |
| `created_at`           | так         | ISO 8601, перше поле                                                         |
| `budget_sec`           | так         | секунди; м'який ліміт — агент сам перевіряє залишок через ENV                |
| `budget_hard_sec`      | ні          | hard kill; відсутнє → `budget_sec × budget_hard_sec_multiplier`; `0` → validation error |
| `budget_total_sec`     | ні          | сумарний wall-clock ліміт version chain; перевищення → `unresolvable`         |
| `progress_timeout_sec` | ні          | kill якщо немає змін `mtime` у worktree N сек                                |
| `deadline`             | ні          | ISO 8601; сортування черги `waiting` (nearest first) та SLA-нагадування watch |
| `audit`                | ні          | `required` \| `optional` \| `off`; default — `audit_policy` з `.mt.json`     |
| `hint`                 | ні          | підказка агенту щодо типу вузла (atomic/composite)                           |
| `parent`               | ні          | відносно `mt/`; відсутній у кореневого                                       |
| `## Task`              | так         | —                                                                            |
| `## Done when`         | так         | —                                                                            |
| `## Check`             | ні          | машинна частина Done when: кожен рядок — shell-команда (exit 0); wrapper ганяє перед прийняттям `mt done`/`mt audit` |
| `## Inputs`            | ні          | відсутній якщо батько нічого не передає і немає inline-даних                 |

Пріоритет budget-полів: CLI-аргумент > `plan_NNN.md` > `.mt-override.json` > `task.md` > `.mt.json`.

**`audit`-політика:** `required` — `mt done` заборонено, лише `mt audit` (вузол стає `resolved` тільки після `audit-result: success`); `optional` (дефолт) — агент сам обирає done/audit; `off` — `mt audit` ігнорується (дешеві вузли). Default — `audit_policy` у `.mt.json`; per-node перекривається фронтматером.

**`## Check` — детермінований гейт:** кожен непорожній рядок секції — shell-команда (`#` — коментар); wrapper виконує їх у worktree **перед** прийняттям `mt done`/`mt audit`. Будь-який ненульовий exit → сигнал відхиляється з виводом команд — агент виправляє і викликає знову. LLM-аудит перевіряє лише те, що не покривається `## Check`.

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
```

| Поле             | Обов'язкове | Примітка                                                      |
| ---------------- | ----------- | ------------------------------------------------------------- |
| `schema_version` | так         | завжди `1` (перше поле)                                       |
| `created_at`     | так         | ISO 8601                                                      |
| `model_tier`     | ні          | `MIM` \| `AVG` \| `MAX`; default: `AVG`                       |
| `skills`         | ні          | список інструментів агента (bash, write-files, web-search, …); кожен мапиться на sandbox-профіль |
| `secrets`        | ні          | декларація потрібних секретів; wrapper інжектить через ENV (див. «Security model») |
| `retry_ladder`   | ні          | per-node перевизначення драбини ретраїв (див. «Політика ретраїв») |

---

#### `h.md`

Мутабельний прапор. Якщо є — вузол виконує **людина**. При перемиканні: видалити `a.md`, створити `h.md`.

```yaml
schema_version: 1
created_at: ISO8601
assignee: vkozlov # handle; контакти — у .mt/directory.json (поза git)
notify: true
qualification: 'senior backend engineer'
```

| Поле             | Обов'язкове | Примітка                                |
| ---------------- | ----------- | --------------------------------------- |
| `schema_version` | так         | завжди `1` (перше поле)                 |
| `created_at`     | так         | ISO 8601                                |
| `assignee`       | ні          | handle виконавця; контакти — у `.mt/directory.json` поза git (див. «Security model») |
| `notify`         | ні          | `true` — надсилати нагадування контакту assignee |
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

**Deps satisfaction:** `ls -R deps/` → для кожного path → обрізати `.md` суфікс → dep-id = відносний шлях від `mt/` → перевірити що dep-вузол у стані `resolved` (прийнятий fact; вузол з відкритим аудитом залежність НЕ задовольняє).

**Приклад `deps/collect-data.md`:**

```markdown
ref: ../collect-data/fact_001.md#results
Використовувати лише перші 50 записів, ігнорувати дублікати.
```

---

---

#### `plan_NNN.md`

Stage 1 output. Immutable. `001` при першому плануванні (зокрема у вузла, відтвореного після `mt kill` через `mt init`); `002`, `003`, … якщо worktree merged або робота продовжується.

````markdown
---
schema_version: 1
created_at: ISO8601
decision: atomic | composite
budget_sec: 3600 # уточнений бюджет (перекриває task file; опціонально)
budget_hard_sec: 10800 # уточнений hard limit (опціонально; 0 → validation error)
progress_timeout_sec: 600 # kill якщо немає змін у worktree N сек (опціонально)
---

## Context

Чому саме такий підхід.

## Approach

<!-- atomic: покроковий план виконання -->
<!-- composite: обґрунтування декомпозиції для людини; машинна специфікація — у ## Children -->

## Children

<!-- лише composite: машинно-парсована специфікація дочірніх вузлів -->

```yaml
children:
  - id: collect-data
    mode: agent # agent | human — обов'язково per-child
    model_tier: AVG # для mode: agent
    skills: [bash, web-search]
    budget_sec: 1800
    export: true # default; false → дитина не потрапляє у ## children батьківського fact
    deps: [] # сусіди: id; cross-level: шлях відносно mt/
    task: |
      Зібрати дані з API за Q4 — стане ## Task дочірнього task.md
  - id: analyze
    mode: human
    qualification: senior analyst # для mode: human
    deps: [collect-data]
    task: |
      Перевірити аномалії у зібраних даних
```

## Risks

Що може піти не так.
````

Пріоритет budget-полів: `plan_NNN.md` > `.mt-override.json` > task file > `.mt.json`. План, написаний inline у поточному run, уточнює бюджети з **наступного** запуску — wrapper читає бюджети на старті.

`plan_NNN.md` не містить поле `mode:` для самого вузла — його визначають `a.md`/`h.md`. Mode дочірніх вузлів задається per-child у `## Children`; з нього `mt spawn --approve` матеріалізує їхні `a.md`/`h.md`. `## Children` обов'язкова для `decision: composite` і заборонена для `decision: atomic`.

Після запису `plan_NNN.md` (decision: composite) вузол у стані `plan-review` — derived: актуальний composite-план без `plan-approved_NNN`/`plan-rejected_NNN`. `mt spawn --approve` валідує `## Children`, матеріалізує дітей і пише `plan-approved_NNN.md` одним commit; `mt spawn --reject --reason` пише `plan-rejected_NNN.md` → вузол повертається у `waiting`, наступний `mt plan` бачить причину. Без approve — жодних дочірніх вузлів. Для атомарних вузлів `plan-review` не застосовується.

---

#### `fact_NNN.md`

Immutable. Успішний вихід вузла. NNN = NNN відповідного `run_NNN.md` (wrapper записує з тим самим NNN). Якщо `run_NNN.md` має `result` ≠ `success` — `fact_NNN.md` не існує (дірка у нумерації). Скрипт читає файл з найбільшим NNN як актуальний.

`## Summary` — обов'язкова перша секція для observability. Решта — довільні порти для наступників.

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:05:00Z
hash: sha256:<content-addressed — вміст fact + вміст усіх ref-цілей>
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

**Composite-батько:** wrapper-агрегат додає секцію `## children` — по рядку `ref:` на актуальний fact кожної дитини (крім позначених `export: false` у `## Children` плану). Споживачі composite-вузла дістають порти дітей через ці ref — atomic і composite взаємозамінні для споживача.

**`hash:`** обчислює wrapper при `mt done`: SHA-256 від канонічного вмісту fact (без фронтматеру) + вмісту кожної локальної `ref:`-цілі у відсортованому порядку (content-addressed). Зміна артефакту за ref змінює hash навіть за незмінного тексту fact.

---

#### `run_NNN.md`

Immutable. Один файл на одну спробу виконавця. Записується wrapper-ом **після** завершення (нормального чи kill). Аудитор `run_NNN.md` не пише.

`result` — повний enum: `success | failed | progress-timeout | budget-exceeded | claim-lost | merge-conflict | decomposed`. Усе ≠ `success` — **failure-сімейство**: `fact_NNN.md` не створюється («дірка» в нумерації), спроба входить у `failed_streak`.

- `success` → wrapper також пише `fact_NNN.md` з тим самим NNN; `run_NNN.md` містить `## Ref → fact_NNN.md`
- `failed` → агент сам здався (`mt failed`) або crash без kill-причини
- `progress-timeout` / `budget-exceeded` → SIGKILL від wrapper
- `claim-lost` → renewal rejected або takeover; publish заборонено
- `merge-conflict` → конфлікт на fenced publish
- `decomposed` → агент написав composite-план (динамічна декомпозиція) → вузол у `plan-review`

**Джерело секцій — `run-draft.md`:** агент протягом виконання веде `run-draft.md` у директорії вузла (git-ignored, перезаписуваний): оновлює `## Completed` / `## Blockers` / `## Next Attempt` після кожного значущого кроку. Wrapper переносить секції з draft у `run_NNN.md`; якщо draft відсутній — заповнює їх сам з телеметрії (причина завершення, stderr, останні змінені файли). Обов'язковість секцій — інваріант **файлу**, а не виконавця.

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:01:00Z
actor: agent
result: budget-exceeded
wall_sec: 10800
worktree: .worktrees/<node-hash>-<token> # failure-сімейство — для debug
---

## Reasoning

Спробував обробити весь датасет одразу — задача занадто велика.

## Completed

Зібрано 312/847 записів у data/partial.json.

## Blockers

Повна обробка не вкладається у budget_hard_sec.

## Next Attempt

Розбити обробку на батчі по 100 записів або декомпозувати вузол.

## Script

exit_code: 137
stderr: SIGKILL budget-exceeded

## Ref

ref: fact_001.md
```

| Поле / секція     | Хто пише   | Коли                                        | Що містить                                   |
| ----------------- | ---------- | ------------------------------------------- | -------------------------------------------- |
| `created_at`      | wrapper    | завжди                                      | ISO 8601                                     |
| `actor`           | wrapper    | завжди                                      | `agent` \| `engineer` \| `human` \| `wrapper` (composite-агрегат) |
| `result`          | wrapper    | завжди                                      | `success` \| `failed` \| `progress-timeout` \| `budget-exceeded` \| `claim-lost` \| `merge-conflict` \| `decomposed` |
| `wall_sec`        | wrapper    | завжди                                      | тривалість спроби (сек); сума по chain — проти `budget_total_sec` |
| `worktree`        | wrapper    | failure-сімейство                           | шлях до worktree (для debug)                 |
| `## Reasoning`    | draft → wrapper | failure: обов'язково; success: рекомендовано | чому так, що вирішив, що спробував           |
| `## Completed`    | draft → wrapper | **обов'язково при failure**            | що вдалось виконати до зупинки               |
| `## Blockers`     | draft → wrapper | **обов'язково при failure**            | конкретні блокери для швидкої діагностики    |
| `## Partial Work` | draft → wrapper | опціонально (failure)                  | часткові результати, дані, незавершений код  |
| `## Next Attempt` | draft → wrapper | **обов'язково при failure**            | рекомендація для наступного агента/інженера  |
| `## Script`       | wrapper    | якщо crash/kill                             | `exit_code:`, `stderr:` (останні `stderr_lines` рядків) |
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

Immutable **без винятків** — пишеться рівно один раз; потреба уточнення оформлюється окремим `clarification_NNN.md` (не вердиктом). NNN = NNN відповідного `pending-audit_NNN.md`. Пишеться виключно аудитором. Невдалий аудит не перезаписується: `fact_N` стає відхиленим, вузол derived-повертається у `waiting` (rework), наступна спроба створює run N+1 і новий fact — без `mt invalidate` і без архівації.

```markdown
---
schema_version: 1
created_at: ISO8601
actor: auditor
result: success | failed
---

## Reasoning

Що перевірено, що схвалено або що конкретно не відповідає ## Done when.
```

| Поле           | Значення                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `actor`        | завжди `auditor`                                                                                                                          |
| `result`       | `success` → fact прийнятий, вузол `resolved`; `failed` → fact відхилений, вузол у `waiting` (rework). Потреба уточнення — НЕ вердикт: окремий `clarification_NNN.md` до фінального рішення |
| `## Reasoning` | обов'язковий; чіткий зв'язок із критерієм `## Done when`                                                                                  |

---

#### `clarification_NNN.md`

Immutable. Запит уточнення від аудитора — **не вердикт**. NNN = NNN відповідного `pending-audit_NNN.md`. Аудит-цикл лишається відкритим (стан `pending-audit`) до фінального `audit-result_NNN.md`.

```markdown
---
schema_version: 1
created_at: ISO8601
actor: auditor
---

## Questions

Що саме треба уточнити щодо fact_NNN.md.
```

---

#### `amended_NNN.md`

Immutable. NNN = NNN відповідного `clarification_NNN.md`. Пишеться агентом у відповідь на запит уточнення. Містить відповідь на питання аудитора, уточнення, виправлення. Дозволяється лише 1 раз: після `amended_NNN.md` аудитор пише фінальний `audit-result_NNN.md` (`success | failed`); якщо неясність лишилася → `failed` → новий run.

```markdown
---
schema_version: 1
created_at: ISO8601
clarification_ref: clarification_NNN.md
---

## Response

Відповідь на зауваження аудитора.
```

---

#### `run-summary.md`

Mutable (перегенеровується). Пише **wrapper** через LLM (`audit_model` tier), коли поспіль failure-ранів ≥ `run_summary_threshold` (дефолт: 5); оновлюється після кожної наступної невдачі. Вміст: аналіз патернів усієї серії — що пробували, що не вийшло, що не варто повторювати. Це **другий шар** стискання поверх детермінованого Prior attempts резюме: контекст агента = Prior attempts + `run-summary.md` (якщо є). Видаляється при `mt invalidate`/`mt kill` (нова version chain — нова історія).

```markdown
---
schema_version: 1
created_at: ISO8601
actor: wrapper
runs_analyzed: 5
---

## Summary

Аналіз патернів: що пробували, що не вийшло, що не варто повторювати.
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
| `h.md` є, немає прийнятого fact, немає active claim                 | `pending`       |
| `a.md` є, deps resolved, немає active claim, немає прийнятого fact, `failed_streak < agent_retry_max` | `waiting`       |
| `a.md` є, deps НЕ resolved                                   | `blocked`       |
| active claim існує і `lease_until > now()`                   | `running`       |
| claim існує, lease expired, renewal/takeover ще не завершено | `stalled`       |
| актуальний `plan_NNN` (composite) без `plan-approved_NNN`/`plan-rejected_NNN` | `plan-review`   |
| актуальний composite-план approved, діти існують, не всі `resolved` | `spawned`       |
| відкритий аудит-цикл актуального `fact_N`: `pending-audit_N` є, `audit-result_N` немає | `pending-audit` |
| є прийнятий fact: актуальний `fact_N` без аудиту або з `audit-result_N: success` | `resolved`      |
| `unresolvable.md` існує (streak вичерпано або `budget_total_sec` перевищено) | `unresolvable`  |
| `run_*.md` є, немає прийнятого fact, active claim немає, `failed_streak ≥ agent_retry_max` | `failed`        |

Пріоритет: `pending-audit` > `resolved` > `unresolvable` > `stalled` > `running` > `plan-review` > `spawned` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`

**Прийнятий fact** — актуальний `fact_N` (max NNN), для якого або аудит не запитувався (немає `pending-audit_N`), або `audit-result_N` має `result: success`. Аудит-гейт **блокуючий**:

- Відкритий аудит-цикл → стан `pending-audit`; deps satisfaction вимагає стану `resolved`, тому залежні вузли чекають фінального вердикту
- `audit-result_N (failed)` → fact відхилений: вузол derived-повертається у `waiting`/`pending` (rework) без invalidate й архівації; наступна спроба = run N+1 із зауваженнями аудитора в контексті
- Перевірка прийнятості читає лише frontmatter `audit-result_*` (`result:`) — єдиний виняток із правила «стан визначається з імен файлів»

**`failed_streak`** — лічильник поточної серії невдач:

```
failed_streak = max(NNN серед run_*.md) - max(NNN серед fact_*.md; 0 якщо fact немає)
```

Обчислюється із самих імен файлів (суцільна нумерація `run_NNN` + «дірки» у `fact_NNN` на невдачах), без читання вмісту. `mt invalidate` архівує весь version chain (run/fact/audit-файли) → streak скидається з новою chain.

- `failed_streak < agent_retry_max` → вузол лишається `waiting`: агент ретраїть з Prior attempts резюме і retry ladder (див. «Політика ретраїв»)
- `failed_streak ≥ agent_retry_max` → `failed`: watch передає вузол EngineerAgent
- Спроби інженера (`actor: engineer`) інкрементують той самий streak: після `agent_retry_max + engineer_retry_max` — watch пише `unresolvable.md`, рішення за людиною (див. «Ескалація: unresolvable»)
- `pending` (h.md) і `unassigned` стоять вище за `failed` свідомо: людські й непризначені вузли EngineerAgent автоматично не чіпає — вирішує людина

Семантика станів очікування:

- `a.md`/`h.md` = **хто** виконує (агент або людина)
- Стан `waiting` = a.md є, deps resolved — runner: `mt run`; без актуального плану (або rejected) агент планує inline першою фазою
- Стан `pending` = h.md є — runner завжди пропускає; людина сама вирішує

Примітки:

- `blocked` → тільки для `a.md` (deps не resolved)
- `failed` → `failed_streak ≥ agent_retry_max`; чекає EngineerAgent (найнижчий пріоритет)

`unassigned` — `task.md` є але не призначено виконавця. Оркестратор пропускає. Watch нагадує (TODO: Telegram) якщо вузол у `unassigned` > `stale_worktree_min` хвилин.

`pending` — `h.md` присутній (з планом або без). Runner завжди пропускає; watch виводить нагадування + notify контакту `assignee` (Telegram TODO). Людина сама вирішує: `mt plan` якщо потрібен план, або `mt run --actor human` якщо план вже є.

`waiting` — `a.md` є, deps resolved. Runner: auto `mt run`; якщо актуального плану немає (або rejected) — агент планує inline першою фазою.

`blocked` — тільки для `a.md`; deps satisfaction перевіряється при `mt scan` (batch). Відображається в `mt status` як `[blocked: <dep-id>]`. Dep з відкритим аудитом → звичайний `blocked` (чекає вердикту). Якщо dep-вузол не існує або не має жодного `fact_*.md` → маркер `blocked-invalid-dep` (підтип `blocked` для відображення, не окремий стан машини), skip.

`plan-review` — актуальний composite-план чекає рішення; runner пропускає, watch нагадує людині.

`spawned` — діти матеріалізовані й рухають граф; runner пропускає батька, fact батька пише wrapper після резолву всіх дітей.

`stalled` — claim branch існує, але `lease_until + claim_grace_sec ≤ now()`. Локальний runner додатково може
перевірити `kill -0 <pid>` за runtime marker, але remote runner не покладається на чужий PID.

Takeover дозволений лише після expiry + grace і виконується CAS-update від exact поточного claim SHA. Старий runner
після takeover втрачає fencing token і не може publish результат.

Пріоритет перевірки: `pending-audit` > `resolved` > `unresolvable` > `stalled` > `running` > `plan-review` > `spawned` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`.

**Deps check — batch scan, не per-node:** Список залежностей = `ls -R mt/<task>/deps/` → шляхи → обрізати `.md` → dep-id. Dep задоволений ↔ dep-вузол у стані `resolved`. Обчислюється в пам'яті при `mt scan` (один раз за цикл, будує граф); з вмісту читається лише frontmatter `audit-result_*` вузлів з аудитом — решта зі самих імен файлів.

**Composite вузол** (є хоча б одна дочірня директорія з `task.md`):

Стан composite вузла визначається так само як атомарного: прийнятий fact є → `resolved`. O(1) — без рекурсивного сканування дітей.

**Composite `fact_NNN.md`** пише **wrapper** (не агент) — тригер: `mt done <child>` після успішного merge:

```
parent = mt/<child>/..
якщо всі children у стані resolved (прийнятий fact):
  → пише синтетичну пару mt/<parent>/run_NNN.md (actor: wrapper, result: success,
    ## Reasoning: "агрегація дітей") + mt/<parent>/fact_NNN.md (NNN = count(run_*.md) + 1)
  → fact: ## Summary = агрегація ## Summary всіх дочірніх вузлів
          ## children = ref: на актуальний fact кожної дитини (крім export: false)
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
  plan [<path>] [--mode agent|human] ← явне планування (людина / перепланування); для агентів
                                       планування — inline перша фаза mt run
  status [<path>] [--json]           ← стан графу
  scan [--json]                      ← повне сканування + exit 1 якщо є failed
  run [<path>] [--actor a] [--auto]  ← запустити вузол або оркестратор
  kill <path> [--no-cascade]         ← archive + git rm вузла і нащадків; SIGTERM живих процесів
  invalidate <path>                  ← архівує fact_*/run_* у history/; cascade вниз по нащадках
  # сигнали агента:
  done <path>                        ← успіх → ## Check (якщо є) → merge
                                       Check fail → відмова, агент виправляє; audit: required → відмова (лише mt audit)
  audit <path>                       ← хоче аудит → ## Check (якщо є) → pending-audit_NNN.md
                                       (NNN = NNN останнього fact_NNN.md; auto-detected)
                                       ВИМАГАЄ наявного fact_NNN.md; помилка якщо відсутній
  failed <path>                      ← провал
  spawn <path> --approve | --reject --reason "..."  ← plan-review рішення: --approve валідує ## Children
                                                      актуального плану і матеріалізує дочірні вузли;
                                                      --reject пише plan-rejected_NNN.md з причиною

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
- Людина доповнює `## Inputs` і `## Done when` вручну; може додати `a.md` або `h.md` для перевизначення

```
mt plan [<path>] [--mode agent]
```

- Явний виклик — для людини (IDE-діалог) або форсованого перепланування; для агентських вузлів планування відбувається **inline першою фазою `mt run`** (агент сам пише `plan_NNN.md`)
- Stage 1: spec + decompose; planning temperature: `plan_temperature` з конфігу (дефолт: `0`)
- `mode` з прапорів: `h.md` = human, `a.md` = agent; `--mode agent` — перевизначає (видаляє `h.md`, створює `a.md`)
- `h.md` — IDE-діалог; `a.md` — автономний
- Вихід atomic: `plan_NNN.md` (decision: atomic) → inline-фаза: агент одразу продовжує виконання тим самим run/claim; явний `mt plan`: вузол лишається `waiting` з актуальним atomic-планом → найближчий runner викликає `mt run` (`touch .mt/wake` пришвидшує)
- Вихід composite: `plan_NNN.md` (decision: composite, обов'язкова `## Children`) → стан `plan-review`. Дочірні вузли НЕ створюються до `mt spawn --approve` — їх матеріалізує spawn із `## Children`; `mt run --auto` підхоплює дітей після approve
- **Composite planning — mode per-child у плані:** планувальник (агент або людина в IDE-діалозі) зобов'язаний вказати у `## Children` `mode` та атрибути (`model_tier`/`skills` або `qualification`) для **кожного** дочірнього вузла індивідуально. Після матеріалізації жодних `unassigned` дітей; дитина без `mode` → validation error на `mt spawn --approve`.

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
- **`--auto` / без `path`**: one-shot оркестратор — знаходить всі `waiting` вузли з `a.md` → `mt run` (планування за потреби — inline перша фаза); кожен запуск спочатку CAS-claim-ить remote branch; `pending` (h.md) і `unassigned` — пропускає
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
  6. Мутація (`git rm -r mt/<path>/` + commit "mt: kill mt/<path>") публікується через **fenced publish protocol** — atomic push з force-with-lease на `main`; protected `main` → integration branch + PR + bot
- Вимагає clean working tree. При незакомічених змінах → error: "commit or stash changes before mt kill".
- **Undo kill** = `git revert <kill-commit>` відновлює весь піддерево.
- exit: `0` all killed | `1` часткова помилка

```
mt invalidate <path>
```

- Архівує **весь version chain**: `fact_*.md`, `run_*.md`, `pending-audit_*.md`, `audit-result_*.md`, `clarification_*.md`, `amended_*.md` → `mt/<node>/history/<ts>-invalidate/`; видаляє `run-summary.md`
- `task.md`, `a.md`/`h.md`, `deps/`, `plan_*` (+ `plan-approved/rejected_*`) залишаються; вузол повертається до `waiting`
- Нова chain стартує з NNN=001 без колізій — у директорії не лишається жодного NNN-файла попередньої chain
- Cascade вниз по нащадках (кожен отримує `mt invalidate` рекурсивно)
- Не пише `invalidated` sentinel — стан derived автоматично з відсутності `fact_*.md`

```
mt scan [--json]
```

- Сканує всі `task.md`, реконструює DAG через `deps/`, виводить стан кожного вузла
- exit: `0` граф чистий | `1` є вузли у стані `failed` (вичерпано `agent_retry_max`, чекають EngineerAgent)

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

> **Prior attempts резюме:** Агент отримує компактне **Prior attempts** резюме замість повних `run_NNN.md`. Wrapper витягує з усіх failure-ранів (`result` ≠ `success`) три секції: `## Completed`, `## Blockers`, `## Next Attempt`. Склеює у резюме фіксованого розміру незалежно від кількості спроб.
>
> `## Completed`, `## Blockers`, `## Next Attempt` — **гарантовано присутні** у кожному failure-рані: джерело — `run-draft.md` агента, fallback — телеметрія wrapper.
> При `result: success` — `## Completed` + `## Summary` (для composite агрегації).
>
> Повні `run_NNN.md` залишаються у директорії для людського аудиту.
>
> **Примітка:** Wrapper генерує `run-summary.md` через LLM (`audit_model` tier), коли failure-ранів ≥ `run_summary_threshold` (дефолт: 5) — другий шар поверх детермінованого резюме. Видаляється при `mt invalidate`/`mt kill`.

**System prompt оркестратора** (агент ніколи не бачить у своїх файлах):

```
Твій файл місії: task.md. Режим виконання: a.md (агент) або h.md (людина). Залежності у deps/.

Крок 1 — якщо актуального plan_NNN.md немає (або він rejected): напиши plan_NNN.md сам
  (Context / Approach / Risks; NNN = max існуючий + 1; composite → додай ## Children)
  → atomic:    план записано → одразу переходь до Кроку 2 (той самий run)
  → composite: план містить ## Children → завершуй
               (матеріалізацію зробить mt spawn --approve після plan-review)

Крок 2 — є актуальний plan_NNN.md (decision: atomic): виконай роботу, потім:
  → впевнений:         запиши fact_NNN.md (NNN із ENV MT_RUN_NNN)
                       виклич: mt done <шлях>   ← wrapper запише run_NNN.md (success)
  → потрібна перевірка: запиши fact_NNN.md (NNN із ENV MT_RUN_NNN)
                       виклич: mt audit <шлях>  ← wrapper запише run_NNN.md (success)
  → помилка:           НЕ пиши fact_NNN.md
                       виклич: mt failed <шлях> ← wrapper запише run_NNN.md (failed)

mt done / mt audit спершу проганяють ## Check з task.md — провал повертає помилку з виводом:
виправ і виклич знову. Вузол з audit: required приймає лише mt audit (mt done → відмова).

Постійно: веди run-draft.md у директорії вузла (## Completed / ## Blockers / ## Next Attempt) —
оновлюй після кожного значущого кроку; при kill wrapper збере run_NNN.md саме з нього.
```

**Агент може читати файли будь-яких вузлів** (батька, братів, дочірніх) без обмежень — свідомий trade-off; межі (sandbox skills, secrets, PII) — див. «Security model».

**Всі агенти запускаються через wrapper-скрипт** — відстежує таймаут і може кілити процес.

---

## Два етапи виконання вузла

**Етап 1 — планування**

- Агентський вузол (`a.md`): **inline-фаза `mt run`** — агент сам пише `plan_NNN.md` першою фазою запуску, без окремого процесу й очікування watch
- Людський вузол (`h.md`) або форсоване перепланування: явний `mt plan` — інтерактивний IDE-діалог

Вихід:

- **Atomic** → `plan_NNN.md` (decision: atomic) → Етап 2 одразу — той самий run/claim/worktree
- **Composite** → `plan_NNN.md` (decision: composite, `## Children`) → стан `plan-review` → `mt spawn --approve` → дочірні вузли

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
  → waiting вузли з a.md → auto mt run (без актуального плану → агент планує inline першою фазою)
      0a. Рахує active agent claims, де `lease_until + claim_grace_sec > now()` → якщо `count ≥ agent_concurrency` → skip до наступного тіку
      0b. Перевіряє: вільне місце на диску >= min_free_disk_gb → якщо ні: Telegram алерт + skip
      0c. `--auto` сортує `waiting` вузли: leaf nodes першими (розблоковують залежні), потім за nearest `deadline` (без нього — за `created_at`) → якщо `running_count ≥ agent_concurrency` → skip решту до наступного тіку
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
waiting + a.md  →  auto: mt run (без плану → агент планує inline першою фазою)
pending + h.md                →  skip + notify людину
```

**`unassigned`** (немає `a.md`/`h.md`): runner пропускає; watch нагадує (TODO: Telegram).

**`waiting`** + `a.md`: watch запускає `mt run` автономно; планування — inline перша фаза run.

**`pending`** + `h.md`: watch виводить нагадування + notify контакту `assignee` (з directory). Runner пропускає.

**`plan-review`** вузли (актуальний composite-план без `plan-approved_NNN`/`plan-rejected_NNN`) — watch пропускає і нагадує людині. Людина: `mt spawn --approve <path>` або `mt spawn --reject <path> --reason "..."`.

**Orphan worktree/run ref:** watch знаходить expired claim і відповідний `run_ref`. Новий owner може або
продовжити цей run після явної перевірки, або залишити ref для debug і створити новий run. Наявність orphan
worktree сама по собі ніколи не дає права publish.

**EngineerAgent:** watch при скані знаходить вузол у стані `failed` (`failed_streak ≥ agent_retry_max`) → запускає `mt run <path> --actor engineer`. До порога невдалий вузол лишається `waiting` і ретраїться звичайним агентом за retry ladder. Streak ≥ `agent_retry_max + engineer_retry_max` → автоспроби припиняються: watch пише `unresolvable.md` + алерт.

---

## Аудит (async черга)

Якісний гейт на вимогу агента або людини. Іде через файлову чергу — не синхронно. Гейт **блокуючий**: вузол з відкритим аудит-циклом має стан `pending-audit` (не `resolved`), тому залежні вузли чекають фінального `audit-result`. Fenced publish у `main` відбувається до аудиту — споживачі спираються на стан вузла, а не на саму наявність `fact_*.md` у `main`.

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
                  → для composite: wrapper пише синтетичну пару run_NNN/fact_NNN у батьківський вузол
        failed  → fenced publish audit-result → fact_N відхилений → вузол derived-повертається у waiting (rework)
            → оркестратор підбирає як звичайний waiting вузол (без invalidate й архівації)
            → run N+1 бачить audit-result_N → fact_(N+1).md → mt audit → pending-audit_(N+1).md → черга знову
        потрібне уточнення → аудитор пише clarification_NNN.md (НЕ вердикт) → fenced publish →
            watch: mt run --actor agent --amend → агент пише amended_NNN.md
            (NNN = NNN clarification; без run_NNN.md — частина аудит-циклу)
            watch виявляє: clarification_NNN.md + amended_NNN.md без audit-result_NNN.md
                → mt run --actor auditor (повторний)
                    аудитор читає fact_NNN.md + amended_NNN.md → пише ФІНАЛЬНИЙ audit-result_NNN.md
                    (success | failed; уточнення лише 1 раз — далі тільки вердикт)

```

**Ліміт циклів:** після 3 поспіль `audit-result_*.md (result: failed)` — watch ескалює (TODO: через Telegram).

**run-summary.md:** після `run_summary_threshold` (дефолт: 5) поспіль failure-ранів wrapper генерує `run-summary.md` (LLM, `audit_model` tier) — другий шар стискання поверх Prior attempts резюме; обидва йдуть у контекст наступних спроб замість повних `run_NNN.md`.

Модель аудитора: `audit_model: "auto"` (дефолт) — той самий tier, що у виконавця вузла: гейт не слабший за роботу. Явний model id у `.mt.json` або `.mt-override.json` перекриває (зокрема свідомо дешевшою моделлю для некритичних вузлів).

---

## Wrapper-скрипт

**Звичайний запуск** (`mt run <path> [--actor agent|engineer|human]`):

1. Читає `task.md` → `budget_sec`, `budget_hard_sec`, `deadline`; читає `a.md`/`h.md` → mode, `model_tier`, `skills`/`qualification`.
2. `ls -R deps/` → список dep-id (strip `.md`); перевіряє що всі deps у стані `resolved` (прийнятий fact). Dep з відкритим аудитом (`pending-audit`) → вузол лишається `blocked`, exit без запуску; dep без `fact_*.md` → `blocked-invalid-dep`, exit з помилкою.
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
7. Визначає NNN = `count(run_*.md) + 1` і `failed_streak`; обирає щабель retry ladder за `MT_ATTEMPT = failed_streak + 1` (лише для `actor: agent`).
8. Запускає агента (cwd = worktree) з ENV; strategy-директива щабля ladder додається до контексту:

   ```
   MT_BUDGET_SEC=<sec> MT_HARD_BUDGET_SEC=<sec> \
   MT_STARTED_AT=<unix> MT_RUN_NNN=<NNN> MT_ATTEMPT=<failed_streak+1> \
   MT_CLAIM_TOKEN=<token> MT_CLAIM_GENERATION=<generation> \
   claude --system-prompt .mt/system-prompt.md \
          --message "solve task at task.md"
   ```

   Агент сам обчислює залишок: `remaining = started_at + budget_sec - now()`

9. Поллінгує worktree кожні 5 сек:
   - жодних змін `mtime` > `progress_timeout_sec` → SIGKILL + `result: progress-timeout`
   - elapsed > `budget_hard_sec` → SIGKILL + `result: budget-exceeded`
   - renewal rejected або current claim token змінився → SIGTERM + `result: claim-lost`; publish заборонено
10. Після виходу агента:

- є `fact_NNN.md` (агент записав) → пише `run_NNN.md` з `result: success` + `## Ref → fact_NNN.md`
- є новий composite-план без fact → `result: decomposed` → вузол у `plan-review`
- інакше → `result: failed` або kill-причина з кроку 9; секції `## Completed`/`## Blockers`/`## Next Attempt` переносяться з `run-draft.md`, без draft — телеметрія wrapper

11. `result: success` або `decomposed` → **fenced publish protocol** (fact або composite-план) → видаляє local marker/worktree → `touch .mt/wake`.
12. Failure-сімейство (`failed`, `progress-timeout`, `budget-exceeded`, `claim-lost`, `merge-conflict`):
    `run_NNN.md` публікується окремим fenced push (лише файли вузла) — failure видимий усім runner-ам;
    run ref/worktree лишається для debug; claim звільняється CAS-delete, лише якщо runner досі ним володіє.

**Запуск аудитора** (`mt run --actor auditor <path>`):

1. Перевіряє наявність `pending-audit_NNN.md` без `audit-result_NNN.md` у main
2. Claim-ить audit operation тим самим CAS-протоколом і створює окремий audit run ref від `base_sha`
   (pending-audit_NNN.md і fact_NNN.md вже в main після merge агента)
3. Spawns auditor subprocess у цьому worktree
4. Чекає виходу → аудитор пише `audit-result_NNN.md` (фінальний вердикт) або `clarification_NNN.md` (запит уточнення)
5. `clarification_NNN.md` → fenced publish → чекає `amended_NNN.md` (watch запустить агента в amend-режимі, потім аудитора повторно). Інакше читає `result`:
   - `success` → **fenced publish protocol** → `touch .mt/wake`
   - `failed` → рахує існуючі `audit-result_*.md (result: failed)` у main:
     - < 3 → **fenced publish protocol** → вузол derived-повертається у `waiting` (rework); наступний run бачить `audit-result_NNN.md`
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

Якщо `main` або claim змінився, push відхиляється без часткового застосування. Runner повторює fetch + rebase з
**exponential backoff + jitter** (старт `publish_retry_base_ms`, множник ×2, ліміт `publish_retry_max`; дефолт:
250 мс / 8 спроб), але продовжує лише якщо claim token досі його. Після вичерпання спроб worktree/run ref лишаються
для debug.

**Батчинг publish:** runner із кількома готовими результатами (типово watch-цикл або post-merge каскад на одному
host) публікує їх **одним** atomic push — кілька result-комітів і CAS-видалення кількох claims в одній операції.
Один push = одне оновлення `main` незалежно від кількості вузлів — основний важіль проти контеншну.

MT при setup перевіряє, що remote рекламує atomic push capability. Якщо capability відсутня, direct publish
**fail closed**; fallback — integration bot/PR, який є єдиним writer у `main` і перед merge перевіряє current claim.

Для protected `main` runner не отримує bypass. Він створює integration branch із commit, на який вказує run ref,
і відкриває PR із claim token у metadata.
Integration bot перевіряє exact claim SHA/token, merge-ить PR і лише після успішного merge CAS-видаляє claim.

Protocol гарантує mutual exclusion лише для compliant MT runners. Щоб fencing було security boundary, прямий push
людей/агентів у `main` забороняється branch protection; єдиний writer — fenced direct-publish identity або integration bot.

**Lifecycle-операції йдуть тим самим шляхом:** `mt init`, `mt spawn --approve|--reject`, `mt invalidate`, `mt kill` —
це теж мутації `mt/` у `main`. Кожна виконує зміни в тимчасовому індексі/worktree і публікує їх через fenced publish
protocol (atomic push з force-with-lease; retry з backoff). На protected `main` — той самий fallback: integration branch +
PR + bot. Другого шляху запису в `main` у MT немає.

**Конфлікти можливі:** агенти можуть змінювати shared project files, тому rebase/merge може конфліктувати.
Конфлікт → `result: merge-conflict`; claim не передається іншому runner до cleanup або expiry.

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
- Знаходить `pending-audit_NNN.md` без `audit-result_NNN.md`: немає відкритого clarification → `mt run --actor auditor`; є `clarification_NNN.md` без `amended_NNN.md` → `mt run --actor agent --amend`; є amended → повторний `mt run --actor auditor`
- Знаходить `failed` вузли (`failed_streak ≥ agent_retry_max`, без активного процесу) → `mt run <path> --actor engineer`
- Знаходить вузли з вичерпаними лімітами (streak ≥ `agent_retry_max + engineer_retry_max` або sum(`wall_sec`) > `budget_total_sec`) → пише `unresolvable.md` + алерт людині
- Знаходить orphan run refs без active claim → пропонує explicit resume або cleanup; автоматичний publish заборонено
- Composite вузол: `mt done <child>` wrapper перевіряє чи всі siblings resolved → якщо так, пише синтетичну пару run/fact батька автоматично (без окремого watch-кроку)
- Знаходить `pending` (h.md) вузли → виводить нагадування + notify контакту `assignee` (Telegram TODO)
- Знаходить `unassigned` (немає a.md/h.md) → виводить нагадування (TODO: Telegram)
- Знаходить `plan-review` вузли → пропускає (чекають approve від людини)
- Перевіряє правило легітимності: вузол має бути у `## Children` approved-плану батька або бути кореневим (`mt init`) → інакше `orphan-node` warning, runner пропускає

**TODO (майбутній daemon):**

| Умова                                                                     | Повідомлення                          |
| ------------------------------------------------------------------------- | ------------------------------------- |
| `pending` (h.md) вузол > `stale_worktree_min` хв                          | потрібна участь людини                |
| ≥ 3 поспіль `audit-result_*.md (result: failed)`                          | audit loop — потрібна людина          |
| вузол перейшов у `unresolvable`                                            | спроби вичерпано — потрібна людина    |
| `stalled` вузол (claim lease + grace минули, renewal відсутній)           | claim прострочено — потрібен takeover |
| граф blocked (всі remaining: `unassigned`/`pending`+h.md або failed-deps) | граф заблокований                     |
| вільне місце на диску < `min_free_disk_gb`                                | disk space alert                      |

Конфіг: `stale_worktree_min` у `.mt.json` (дефолт `30`).

exit: `0` проблем немає | `1` є вузли що потребують уваги

---

## Протокол spawn (розкладання вузла на підграф)

Агент вирішує "composite" в Stage 1 (`mt plan`). **Структуру підграфу пропонує виключно агент** через `## Children` плану; матеріалізація — лише після plan-review.

**`mt spawn` не має прапора `--mode`** — mode кожної дитини визначено per-child у `## Children`. Дитина без `mode` (або з невалідним id/deps) → validation error на `mt spawn --approve`.

```
mt plan <path> → decision: composite (## Children) → стан plan-review:
  → людина: mt spawn --approve <path>
      1. валідує ## Children: naming convention id, mode per-child, deps існують, циклів немає
      2. для кожного дочірнього (з plan_NNN.md ## Children):
         mkdir <node-id>/
         пише <node-id>/task.md                    ← task: зі специфікації (+ parent, budget_sec)
         пише <node-id>/a.md або h.md              ← mode зі специфікації (model_tier/skills | qualification)
         пише <node-id>/deps/<dep-node-id>.md      ← по одному на кожну залежність (siblings або cross-level)
      3. пише plan-approved_NNN.md; матеріалізація + sentinel — один commit (fenced publish, атомарно)
  → або: mt spawn --reject <path> --reason "..." → пише plan-rejected_NNN.md (план лишається у version chain)
      → вузол повертається у waiting → наступний mt plan бачить причину відхилення → plan_NNN+1
```

**Cross-level deps при spawn:** `deps/` підтримує вкладену структуру — сусіди (`deps/sibling.md`) або крос-рівневі (`deps/other-branch/node.md`). Оркестратор визначає dep-id через `ls -R deps/` + strip `.md`.

**Динамічна декомпозиція** (потреба у підвузлах виявлена під час виконання) — той самий plan-review шлях:

```
агент (будь-коли в Stage 2) →
  пише plan_NNN+1.md (decision: composite, ## Children — решта роботи як підвузли)
  завершує run без fact → wrapper фіксує result: decomposed (часткові результати у ## Partial Work)
  → вузол у plan-review (актуальний план composite без approve; пріоритет вище waiting/failed)
  → mt spawn --approve → діти матеріалізовані → батько агрегує як звичайний composite
```

Обхід гейта прямим mkdir заборонено — **правило легітимності**: вузол легітимний ↔ його id є у `## Children`
approved-плану батька, або це кореневий вузол із `mt init`. Інші директорії з `task.md` → `orphan-node` warning,
runner пропускає.

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
wrapper: git merge → конфлікт → result: merge-conflict
                   → worktree залишається для debug
                   → watch: EngineerAgent вирішує як звичайний failed вузол
```

Конфлікт злиття = звичайний `failed`. Той самий патерн відновлення що і при будь-якій іншій помилці.

### Ліміти worktree

`agent_concurrency` у конфізі — ліміт active agent claims, а не локальних директорій. Людські claims (h.md) не
рахуються. `warn_worktrees_above` — локальний поріг попередження. Черга очікування якщо global claim limit вичерпано.

---

## Політика ретраїв (retry ladder)

До порога `agent_retry_max` (дефолт: 3) невдалий вузол лишається `waiting` — агент ретраїть автоматично. Щоб ретраї не повторювали той самий підхід, wrapper детерміновано змінює «позу» кожної спроби:

| `MT_ATTEMPT` (= failed_streak + 1) | Поза спроби                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1                                  | базова — `a.md` як є                                                                                        |
| 2                                  | **diagnose-first** — спершу відтворити й діагностувати `## Blockers` попереднього рану, потім виправляти    |
| 3                                  | **alternative-approach** — підходи спроб 1–2 заборонені; опціонально `model_tier: +1` і додаткові `skills`  |

Драбина декларативна — `retry_ladder` у `.mt.json`, перевизначається per-node у `a.md`:

```yaml
retry_ladder:
  - {} # спроба 1: як у a.md
  - strategy: diagnose-first # спроба 2
  - strategy: alternative-approach # спроба 3 — остання перед engineer
    model_tier: +1 # ескалація на один рівень (MIM→AVG→MAX)
    skills_add: [debug]
```

- `strategy:` — ім'я вбудованого prompt-блоку, який wrapper додає до контексту запуску поряд із Prior attempts резюме
- `model_tier: +1` / `skills_add:` — capability-ескалація лише для цієї спроби; `a.md` не змінюється
- Драбина застосовується тільки до `actor: agent`; інженер працює за власним `.mt/engineer-prompt.md`
- Диверсифікація = поведінкові директиви + capability-ескалація, а не окремі «debug»-вузли: streak і щабель wrapper обчислює детерміновано, без участі LLM
- Коротша за `agent_retry_max` драбина → останній щабель повторюється
- Спроба з `alternative-approach` може записати новий `plan_NNN.md` — нумерація планів продовжується за загальним правилом

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
predecessor у стані resolved (прийнятий fact)
  → можна стартувати
  → інакше (fact відсутній, відхилений аудитом або на аудиті) — очікувати
```

### Каскад інвалідації

```
patch(analyze) →
  mt invalidate analyze →
    архівує analyze/fact_*.md → analyze повертається у waiting
    каскад: mt invalidate synthesize, report → архівує їх fact_*.md → ...
```

`mt kill` — завжди cascade: видаляє вузол і весь downstream через `git rm -r` + архів у `.history/`.

**Differential cascade при re-run після invalidate:** `mt done` порівнює content-addressed hash нового `fact_NNN.md` з hash останнього fact попередньої chain (з `history/<ts>-invalidate/`). Hash покриває і вміст fact, і вміст усіх ref-цілей — однаковий hash ⇒ результат справді ідентичний → залежні вузли залишаються `resolved` (їх `fact_*.md` не зачіпається). Різний hash → каскад `mt invalidate` продовжується вниз.

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

Часовий бюджет обмежує **тривалість кожної спроби**; streak-пороги (`agent_retry_max`, `engineer_retry_max`) визначають, **хто** виконує наступну спробу (агент → інженер → unresolvable); `budget_total_sec` обмежує chain цілком. Інженер адаптує стратегію до залишку:

- Багато часу — складна спроба
- Мало часу — швидке виправлення
- `залишок <= 0` — wrapper завершує спробу; вичерпані streak- або total-ліміти → `unresolvable`

---

## Ескалація: unresolvable

Автономна ескалація має **один рівень** — після вичерпання спроб рішення передається людині:

```
вузол X: failed_streak ≥ agent_retry_max + engineer_retry_max
  → watch пише unresolvable.md (immutable: причина + резюме спроб)
  → алерт людині (Telegram/email)

людина вирішує:
  - mt invalidate <X> (+ правка task.md за потреби) → нова chain, лічильники скинуто
  - mt kill <X>
  - mt run <предок> --actor engineer   ← ручний запуск інженера ширшого scope (GraphPatch)
```

`unresolvable.md` — термінальний маркер: runner і watch пропускають вузол (жодних автоспроб), залежні лишаються
`blocked`. `mt invalidate` архівує маркер разом із version chain — єдиний штатний вихід.

**Сумарний ліміт:** опціональний `budget_total_sec` (task.md або конфіг) — wrapper акумулює `wall_sec` усіх ранів
chain; перевищення → `unresolvable` негайно, незалежно від streak.

**Максимальний час до людини:** `(agent_retry_max + engineer_retry_max) × budget_hard_sec` (+ watch-цикли) —
незалежно від глибини графа.

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
  "publish_retry_max": 8,
  "publish_retry_base_ms": 250,
  "warn_worktrees_above": 4,
  "agent_concurrency": 5,
  "max_worktree_age": 14400,
  "min_free_disk_gb": 10,
  "default_budget_sec": 1800,
  "default_budget_hard_sec": 3600,
  "budget_hard_sec_multiplier": 3,
  "progress_timeout_sec": 300,
  "stderr_lines": 50,
  "default_model_tier": "AVG",
  "plan_temperature": 0,
  "agent_retry_max": 3,
  "engineer_retry_max": 2,
  "retry_ladder": [
    {},
    { "strategy": "diagnose-first" },
    { "strategy": "alternative-approach", "model_tier": "+1", "skills_add": ["debug"] }
  ],
  "run_summary_threshold": 5,
  "claude_model": "claude-sonnet-4-6",
  "audit_policy": "optional",
  "audit_model": "auto",
  "model_map": {
    "MIM": "claude-haiku-4-5-20251001",
    "AVG": "claude-sonnet-4-6",
    "MAX": "claude-opus-4-8"
  },
  "skill_profiles": {
    "bash": { "allow": ["bun", "git"], "network": false, "fs_scope": "worktree" },
    "web-search": { "network": true }
  },
  "stale_worktree_min": 30,
  "system_prompt": ".mt/system-prompt.md"
}
```

`agent_concurrency: 5` — ліміт паралельних **агентських active claims**. Людські claims (actor: human, h.md) не
рахуються. Watch перед spawn перевіряє remote claims, а не локальний список worktrees.

`agent_retry_max` — скільки поспіль невдалих спроб (`failed_streak`) дозволено агенту, перш ніж вузол перейде у
`failed` і його забере EngineerAgent. `engineer_retry_max` — скільки спроб має інженер до `unresolvable`.
`retry_ladder` — драбина диверсифікації ретраїв (див. «Політика ретраїв»).

`audit_policy` — дефолт для вузлів без поля `audit:` у task.md (`required` | `optional` | `off`).
`audit_model: "auto"` — аудитор отримує tier виконавця вузла (аудит не слабший за виконання); явний model id перекриває.

`claim_lease_sec` — строк ownership; `claim_renew_sec` має бути істотно меншим за lease; `claim_grace_sec` —
буфер перед takeover. Claim timestamps записуються в UTC, але correctness takeover додатково захищається exact-SHA CAS.

Для `actor: human` використовуються довші `human_claim_lease_sec` і `human_claim_renew_sec`. CLI показує
`runner_id`, `lease_until`, worktree і run ref, щоб інша машина або людина не почала той самий вузол випадково.

Кожен task-файл (`task.md` + `a.md`/`h.md`) може перевизначити `budget_sec` локально.

`budget_hard_sec: 0` → validation error — hard limit не можна вимкнути. Відсутнє поле → `default_budget_hard_sec` або `budget_sec × budget_hard_sec_multiplier`.

Per-node override: `mt/<node>/.mt-override.json`

```json
{
  "budget_sec": 7200,
  "audit_model": "claude-opus-4-8"
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

## Security model

**Sandbox-профілі skills.** Кожен skill з `a.md` мапиться на профіль у `.mt.json` → `skill_profiles`: allowlist
команд, мережевий доступ (off за замовчуванням), fs-scope (запис лише у worktree). Wrapper запускає агента з
профілем = об'єднання профілів його skills; команда поза allowlist → відмова виконання, агент бачить помилку.

**Secrets broker.** Секрети ніколи не зберігаються у файлах вузлів і не комітяться. Агент декларує потребу в
`a.md` → `secrets: [STRIPE_KEY]`; wrapper перед запуском бере значення з OS keychain / CI secrets store та інжектить
через ENV. В артефактах (fact/run) секрети заборонені — wrapper маскує відомі значення у виводі (`***`).

**PII поза репо.** `h.md` містить `assignee: <handle>` замість email; мапінг handle → контакти (email, Telegram)
живе у `.mt/directory.json` (git-ignored) або зовнішньому довіднику. У git-історії немає персональних даних.

**Read-scope — свідомий trade-off.** Агент читає файли будь-яких вузлів (дешевий контекст, прозорість); межа
безпеки — інваріант «у файлах вузлів немає секретів», а не ізоляція читання. Командам із жорсткішими вимогами —
ізоляція на рівні tasks-root (окремий `mt/` на команду/тенанта).

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
  - вузли у стані failed      (run_*.md без fact_*.md, failed_streak ≥ agent_retry_max, без active claim)
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
- **Main — точка серіалізації:** publish-и мержаться послідовно в один ref; батчинг + backoff пом'якшують контеншн, але при стабільно високому потоці publish (>~10/хв) черга росте — природна стеля git-refs координації

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
| Декомпозиція                   | Динамічна: Stage 1 (`mt plan`) або під час виконання — завжди через composite-план і plan-review                                                                                                                                                                 |
| Хто вирішує структуру підграфу | Агент (LLM) пропонує через `## Children`; людина схвалює (plan-review)                                                                                                                                                                                    |
| Ребра                          | Потік даних (виходи → входи); топологія у `deps/` кожного вузла                                                                                                                                       |
| Центральний файл графу         | Відсутній — оркестратор сканує `task.md` + `a.md`/`h.md` + `deps/`                                                                                                                                    |
| Формат файлів                  | Markdown + YAML-фронтматер                                                                                                                                                                            |
| Атрибути фронтматеру           | Англійські, snake_case                                                                                                                                                                                |
| Імена файлів і директорій      | Англійська (обробляються скриптами)                                                                                                                                                                   |
| Всі файли                      | Immutable — новий факт = новий файл (винятки — мутабельні прапори: `a.md`/`h.md`, git-ignored `running_*`/`run-draft.md`, `run-summary.md`)                                              |
| schema_version                 | Перше поле у всіх YAML-фронтматерах; поточна версія `1`; оркестратор відмовляє при невідомій версії                                                                                                   |
| deps/ naming                   | Файли з розширенням `.md`; `deps/` може бути вкладеною (дзеркалює `mt/`); dep-id = відносний шлях від `deps/` без `.md`; `ls -R deps/` → список dep-id                                                |
| Часовий бюджет                 | `budget_sec` (м'який, агент перевіряє через ENV) + `budget_hard_sec` (hard kill; завжди увімкнений, 0 → error)                                                                                                          |
| Бюджет уточнення               | `plan_NNN.md` може перекрити `budget_sec`/`budget_hard_sec`/`progress_timeout_sec`                                                                                                                    |
| Budget priority                | `plan_NNN.md` > `.mt-override.json` > task file > `.mt.json`                                                                                                                                          |
| ENV для агента                 | `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, `MT_RUN_NNN`, `MT_ATTEMPT`, `MT_CLAIM_TOKEN`, `MT_CLAIM_GENERATION`                                                                                         |
| Progress watchdog              | `progress_timeout_sec`: kill якщо немає змін `mtime` у worktree N сек                                                                                                                                 |
| Execution claim                | GitHub custom ref `refs/mt/claims/<node-hash>`; create/renew/takeover/release лише через exact-SHA CAS                                                                                                |
| Run ref                        | `refs/mt/runs/<node-hash>/<token>` від claim `base_sha`; worktree detached і ніколи не checkout-ить `main`                                                                                            |
| Stall detection                | Claim існує та `lease_until + claim_grace_sec ≤ now()`                                                                                                                                                |
| Fencing                        | Publish дозволено лише owner актуального claim SHA/token/generation; claim-lost runner завершується без publish                                                                                       |
| Agent concurrency              | `agent_concurrency` — ліміт active agent claims (h.md не рахуються)                                                                                                                                   |
| Auditor worktree               | Окремий audit run ref від claim `base_sha`; той самий claim/fencing protocol                                                                                                                          |
| Актори виконавців              | `agent` \| `engineer` \| `human` \| `wrapper` (composite-агрегат) — поле `actor` у `run_NNN.md`                                                                                                                                        |
| Актор аудиту                   | `auditor` — пише виключно `audit-result_NNN.md`                                                                                                                                                       |
| Нумерація                      | `run_NNN.md` (корінь, кожна спроба); якщо success → `fact_NNN.md` (той самий NNN); якщо `mt audit` → `pending-audit_NNN.md` (NNN fact) → `audit-result_NNN.md` (NNN pending)                          |
| Run result enum                | `success` \| `failed` \| `progress-timeout` \| `budget-exceeded` \| `claim-lost` \| `merge-conflict` \| `decomposed`; усе ≠ success — failure-сімейство (без fact, входить у streak)                  |
| Run draft                      | агент веде git-ignored `run-draft.md` (Completed/Blockers/Next Attempt); wrapper переносить секції у `run_NNN.md`, fallback — телеметрія                                                              |
| NNN source                     | wrapper рахує `count(run_*.md) + 1` до старту; агент отримує через ENV `MT_RUN_NNN`                                                                                                                   |
| Plan artifact                  | `plan_NNN.md` (numbered, immutable; без `mode:` поля) — вихід Stage 1; секції: Context, Approach, Children (composite), Risks                                                                                               |
| Plan phase                     | Inline: агент пише `plan_NNN.md` першою фазою `mt run` (atomic → одразу виконання, той самий claim); явний `mt plan` — людина / форсоване перепланування                                              |
| Plan review                    | Composite план (`## Children`) → `plan-review`; `--approve` валідує і матеріалізує дітей + `plan-approved_NNN`; `--reject --reason` → `plan-rejected_NNN`                                                                                                  |
| Plan temperature               | `plan_temperature: 0` у конфізі для детермінованого планування                                                                                                                                        |
| Refs                           | `ref: path#section` відносно поточного файлу; без копій даних                                                                                                                                         |
| Стан вузла                     | Derived: durable lifecycle з артефактів вузла, runtime ownership з remote claim refs; `resolved` = прийнятий fact                                                                                                                  |
| Стани                          | `unassigned`, `pending`, `waiting`, `blocked`, `plan-review`, `spawned`, `running`, `stalled`, `pending-audit`, `resolved`, `failed`, `unresolvable`                                                                           |
| Протокол агента                | System prompt оркестратора (не у файлах вузла)                                                                                                                                                        |
| Ізоляція агента                | Читання вузлів вільне (trade-off, див. Security model); запис — лише worktree; команди — allowlist sandbox-профілю skills                                                                                                                                                       |
| Відновлення після збою         | Сканування `run_*.md`: streak < `agent_retry_max` → waiting (агент ретраїть); streak ≥ порога → failed → EngineerAgent                                                                                                                                                |
| Паралельність                  | Detached Git worktree + remote run ref; один active claim на вузол                                                                                                                                    |
| Атомарність                    | Fenced remote publish; наступник стартує лише після `resolved` попередника (publish + прийнятий аудит, якщо запитувався)                                                                                                                            |
| Злиття                         | Fetch + rebase + CAS/atomic push; retry з backoff+jitter (`publish_retry_max`); батчинг кількох результатів одним push; конфлікт → `result: merge-conflict` → EngineerAgent                                                                                                        |
| Межа immutability              | До worktree — вільно; після — тільки нові файли                                                                                                                                                       |
| Патч залежного вузла           | Kill наступників (топологічний порядок), потім патч                                                                                                                                                   |
| Самовідновлення                | EngineerAgent — мета-рівень, необмежений доступ; тригер: `failed_streak ≥ agent_retry_max`                                                                                                                                                       |
| Інвалідація                    | `mt invalidate`: архівує весь version chain (fact/run/pending-audit/audit-result/clarification/amended) → history/, нова chain з 001; cascade вниз. `mt kill`: archive + git rm вузла; `--no-cascade` — escape hatch                                                        |
| Deps blocked-invalid           | Dep задоволений ↔ dep `resolved` (прийнятий fact); dep на аудиті → `blocked`; dep без `fact_*.md` → `blocked-invalid-dep`, skip                                                                                                                              |
| Збіжність                      | Часовий бюджет на спробу + streak-пороги зміни актора (`agent_retry_max` → engineer, далі → unresolvable); `budget_total_sec` — сумарний ліміт chain                                                                                                                                                                   |
| Retry ladder                   | `failed_streak = max(run NNN) - max(fact NNN)`; драбина: базова → diagnose-first → alternative-approach (+`model_tier: +1`, `skills_add`); конфіг `retry_ladder`, per-node у `a.md`                    |
| Ескалація                      | Один рівень: streak/total вичерпано → `unresolvable.md` + алерт; інженер предка — вручну; вихід — `mt invalidate`/`kill`                                                                                                                               |
| Composite resolved             | прийнятий fact є (unified — той самий механізм що й атомарний); O(1) перевірка                                                                                                                         |
| Composite fact                 | `mt done <child>` → всі siblings resolved → wrapper пише синтетичну пару run+fact батька (actor: wrapper; Summary = агрегація, `## children` = ref на facts дітей); рекурсивно вгору                                               |
| Check гейт                     | `## Check` у task.md: кожен рядок — shell-команда; wrapper ганяє перед прийняттям done/audit; fail → відмова сигналу                                                                                   |
| Audit policy                   | `audit: required \| optional \| off` (task.md; дефолт `audit_policy` з конфігу); required → лише `mt audit`; `audit_model: auto` = tier виконавця                                                      |
| Аудит                          | Async черга, блокуючий гейт: `mt audit` → `pending-audit_NNN.md` (вузол НЕ resolved, залежні чекають); watch dispatches `mt run --actor auditor`                                                                                                           |
| Audit clarification            | аудитор пише `clarification_NNN.md` (не вердикт) → агент `amended_NNN.md` → фінальний `audit-result_NNN.md`; лише 1 раз                                                                                                                      |
| Run-summary                    | Після `run_summary_threshold` failure-ранів wrapper генерує `run-summary.md` (LLM, audit_model) — другий шар поверх Prior attempts                                                                                                                            |
| Pending audit                  | NNN = NNN відповідного `fact_NNN.md`; оброблено якщо ∃ `audit-result_NNN.md`                                                                                                                          |
| Audit result                   | NNN = NNN відповідного `pending-audit`; окремий трек від `run_NNN.md`; failed → fact відхилений, rework run N+1                                                                                                                                 |
| Audit ліміт                    | 3 failed cycles → watch ескалює через Telegram                                                                                                                                                        |
| Merge після аудиту             | `mt run --actor auditor`; success → fenced publish або protected-main integration bot                                                                                                                 |
| Orphan worktree                | Expired claim + run ref → explicit resume або debug; orphan ніколи не дає publish ownership                                                                                                           |
| Оркестратор                    | `mt run --auto` (one-shot, post-merge hook) + `mt watch` (periodic rescan, 5 хв)                                                                                                                      |
| Mutual exclusion               | Create-only claim push: перший accepted, concurrent runners отримують rejected non-fast-forward/CAS                                                                                                   |
| Init без --mode                | вузол `unassigned` + CLI warning; виконавця призначають явно (`mt init --mode` або touch `a.md`/`h.md`)                                                                                                   |
| Actor/Mode                     | `a.md` = агент (model_tier, skills); `h.md` = людина (qualification); немає = `unassigned`. Стан `waiting` = a.md є, deps resolved (runner обирає plan або run); `pending` = h.md є, runner пропускає |
| Spawn специфікація             | mode та атрибути кожної дитини — per-child у `## Children` плану; дитина без `mode` → validation error на `--approve`                                                                                                                           |
| mode: human headless           | `--auto` і watch пропускають `h.md` (`pending`); людина запускає вручну через `mt run`                                                                                                                |
| Watch роль                     | Periodic rescan (5 хв): черга аудиту + попередження; TODO: daemon + Telegram                                                                                                                          |
| Executor assessment            | `a.md` = агент (`model_tier`, `skills`); `h.md` = людина (`qualification` TODO); немає = `unassigned`                                                                                                 |
| Model tiers                    | MIM→haiku, AVG→sonnet (default), MAX→opus; задається через `model_map` у конфізі                                                                                                                      |
| Disk check                     | `min_free_disk_gb` у конфізі; watch alertує і skip при нестачі місця                                                                                                                                  |
| plan_NNN.md нумерація          | merged/active → продовжується; 001 — лише новостворений вузол (після kill потрібен re-init)                                                                                                                           |
| Ліміти worktree                | `agent_concurrency` — global ліміт agent claims; `warn_worktrees_above` — локальний поріг; `min_free_disk_gb` для disk check                                                                          |
| history/ структура             | `mt/<node>/history/<ts>-invalidate/` — архів після invalidate; `<tasks-root>/.history/<ts>-kill-<path>/` — архів kill                                                                                 |
| Lifecycle у main               | `init`/`spawn`/`invalidate`/`kill` — той самий fenced publish protocol; protected main → integration branch + PR + bot; другого шляху запису немає                                                     |
| Security                       | `skill_profiles` (allowlist/network/fs-scope), secrets через ENV-broker (ніколи у файлах), PII поза репо (`assignee` handle + `.mt/directory.json`)                                                    |
| Монорепо                       | Кожен workspace має свій `mt/`; `MT_DIR` env вказує поточний; один watch на mt/ root; worktrees спільні (git root)                                                                                    |
| Моніторинг                     | `mt scan` — durable стан із файлів + runtime ownership через `git ls-remote` claim refs                                                                                                               |
