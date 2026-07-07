---
type: review
description: 'Розбір зауважень рецензії контракту 0.2.0 і внесені зміни (fencing, TOCTOU, protected main)'
tags: [review, contract]
timestamp: 2026-06-11
---

# Відповідь на рецензію `mt.md`

<!-- markdownlint-disable MD036 -->

---

## 1. Claim не гарантує mutual exclusion виконання

**Статус: Вирішено**

Зауваження коректне. Внесено зміни:

- Секція **Fencing** доповнена абзацом "Межа fencing — лише Git publish": явно зазначено, що гарантія = **single publish owner**, а не mutual exclusion виконання; zombie-runner може продовжувати роботу до власного завершення.
- Задачі з non-idempotent side effects (платіж, API-запит, зміна БД, deployment, відправлення повідомлення) не можна auto-takeover-ити без передачі `generation` або idempotency key у зовнішню систему.
- Рядок "Protocol гарантує mutual exclusion…" → "Protocol гарантує **single Git publisher**".
- Таблиця summary: рядок `Mutual exclusion` → `Single publish owner`.

---

## 2. Protected-main fallback має TOCTOU race

**Статус: Вирішено**

Зауваження коректне. Внесено зміни:

- GitHub Merge API **повністю прибрано** з протоколу.
- Integration bot тепер виконує той самий **fenced atomic `git push --atomic`** що й direct publisher (з `--force-with-lease` на `main`, claim ref та run ref одночасно).
- PR залишається як **approval interface** (review + CI), але merge виконується не GitHub API, а безпосередньо ботом.
- Оновлено CLI-список, секцію fallback і таблицю summary.

---

## 3. Differential cascade суперечить invalidate

**Статус: Вирішено**

Зауваження коректне. Відхилено пропозицію `--defer-cascade` як флаг і стан `blocked-stale` — вони надлишкові. Внесено зміни:

- `mt invalidate` архівує **лише target вузол**; нащадки природно стають `blocked` (upstream не `resolved`), їх `fact_*.md` не чіпаються.
- Cascade запускається тільки після re-run і hash-порівняння: однаковий hash → нічого не треба; різний → `mt invalidate` на нащадках (той самий deferred механізм).
- `mt kill` явно позначено як eager cascade — тільки для остаточного видалення topology.
- Схема і таблиця summary оновлені.

---

## 4. Patch protocol плутає kill та invalidate

**Статус: Вирішено**

Зауваження коректне. `mt stop` як окрема user-facing команда залишена (вже присутня), але `mt invalidate` розширено: якщо вузол має активний claim, wrapper спочатку виконує SIGTERM + CAS-delete claim перед архівацією.

Внесено зміни:

- Patch protocol виправлено: `mt kill <successor>` → `mt stop` + `mt invalidate`.
- Engineer protocol: `mt kill <dep-node>` → `mt stop` + `mt invalidate` (kill тут безглуздий — наступний крок патчить вже "вбитий" вузол).
- Engineer permissions уточнено: `mt kill` — тільки для остаточного видалення topology.

---

## 5. Dependency addressing неоднозначний

**Статус: Вирішено**

Зауваження коректне. Відхилено structured YAML dep-файли — filename-as-id простіший і консистентніший з абсолютними шляхами. Внесено зміни:

- Прибрано концепцію "sibling dep як скорочення".
- Додано явний приклад nested sibling: `quarterly-anomalies/analyze` → сусід `quarterly-anomalies/collect-data` → файл `deps/quarterly-anomalies/collect-data.md`.
- Правило зафіксовано: **завжди повний шлях від `tasks_root`** — не існує "коротких" dep-ів для сусідів вкладених вузлів.

---

## 6. `run_NNN.md` draft не захищений від zombie-writes

**Статус: Misread**

Зауваження ґрунтується на помилковому розумінні архітектури файлів:

- `run_NNN.md` — **immutable**, записується wrapper **один раз після завершення** (`mt done`/`mt failed`). Агент туди не пише під час виконання.
- Під час виконання агент веде `run-draft.md` (git-ignored, локальний worktree), який ніколи не потрапляє у shared state напряму.
- Fencing (claim перевірка) відбувається саме в момент запису `run_NNN.md` wrapper-ом: zombie отримає `claim-lost` і `run_NNN.md` не буде створено.

У документ додано явне пояснення та best practice: runner має перевіряти claim у ключових точках виконання (перед spawn, перед дорогим LLM-дзвінком, перед зовнішнім API) — не перед кожним оновленням draft.

---

## 7. `node-hash` — незадокументована функція та collision-ризик

**Статус: Misread**

Алгоритм **вже задокументований** (рядок: `` `node-hash` = перші 20 hex символів SHA-256 від канонічного `<tasks-root>\0<node-path>` ``).

Пропозиція sanitized path **не є collision-free**:

- `a/b` і `a-b` (root-level вузол із дефісом у назві) дають однаковий `a-b` → collision.
- Sanitized path не вирішує Git ref hierarchy: `refs/mt/claims/research` і `refs/mt/claims/research/analyze` — неможлива пара в Git.

80-bit SHA-256 дає birthday-collision probability ≈ 10⁻¹⁸ для 10⁶ вузлів. У документ додано обґрунтування вибору hash над sanitized path із контрприкладом collision.

---

## 8. Worktree naming collision між паралельними runners

**Статус: Підтвердження — документація доповнена**

Naming scheme унікальна за конструкцією: `token` — UUID4, генерується при кожному claim create і takeover. CAS-протокол гарантує що два runner-и не можуть отримати однаковий token. У документ додано explicit guarantee поруч із кроком створення worktree.

---

## 9. Stale worktrees після failed run

**Статус: Вирішено**

Зауваження доречне. Внесено зміни:

- Додано команду `mt cleanup [--older-than N]` (дефолт: 7 днів): видаляє orphan worktrees (без active claim), відповідні run refs і локальні `running_*.pid` маркери.
- `mt watch` автоматично викликає `mt cleanup` при кожному старті.
- Active worktrees (є живий claim) не чіпаються незалежно від віку.

---

## 10. `mt watch` є єдиним GC механізмом для run refs

**Статус: Misread**

Run refs видаляються при **successful publish** (`mt done`) як частина atomic push (`:refs/mt/runs/<node-hash>/<token>` — delete refspec у тому ж `git push --atomic`). `mt watch` GC покриває лише **failure/orphan** випадки — run refs від crashed або claim-lost runner-ів, що лишаються для debug.

У документ додано явне пояснення цієї різниці.

---

## 11. `mt done` без попереднього `fact_NNN.md` не валідується явно

**Статус: Вирішено**

Зауваження доречне. Логіка вже була в документі неявно (wrapper перевіряв наявність `fact_NNN.md` при step 10). Внесено зміни:

- `mt done` (і `mt audit`) тепер явно описані як команди що **спочатку перевіряють наявність `fact_NNN.md`** і відмовляють з помилкою якщо файл відсутній.
- CLI-список і system prompt оновлені симетрично до опису `mt audit` (де ця перевірка вже була явною).

---

## 12. Lease renewal race між паралельними host-ами

**Статус: Вирішено**

Зауваження коректне — протокол захищений, але explicit failure case і recovery steps були відсутні. Внесено зміни:

- Додано блок "Failure case — concurrent renewal від двох host-ів" з покроковим описом:
  1. Обидва runner-и читають однаковий claim SHA.
  2. CAS приймає лише перший push.
  3. Той чий push відхилено: re-read claim → перевірка `token` → якщо той самий (власна гонка) → перемикається на нову SHA; якщо інший → SIGTERM + `result: claim-lost`.

---

## 13. `pending-audit` state не захищений claim-ом

**Статус: Misread**

Рецензент сам підтверджує у зауваженні: аудитор claim-ить вузол через `mt run --actor auditor` — той самий CAS-протокол що й для agent/engineer/human. Паралельний запуск кількох аудиторів неможливий.

У документ додано явне підтвердження у секції `pending-audit`.
