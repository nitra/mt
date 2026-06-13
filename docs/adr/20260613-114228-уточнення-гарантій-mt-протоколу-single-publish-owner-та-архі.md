---
session: aed62faa-1a62-4a87-9c86-e7918fd91fb2
captured: 2026-06-13T11:42:28+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-mt/aed62faa-1a62-4a87-9c86-e7918fd91fb2.jsonl
---

Готово. `schema_version: 1` додано першим полем у `.mt.json` і описано правило: оркестратор відмовляє запускатись при невідомому значенні.
[user]
дякую, це всі зауваження
[assistant]

## ADR Уточнення гарантій MT-протоколу: single publish owner та архітектурні виправлення

## Context and Problem Statement
Колега надав 10 зауважень до документа `npm/docs/mt.md` (версія 0.2.0), що описує протокол динамічного графу задач MT. Зауваження виявили невідповідності між задекларованими гарантіями (mutual exclusion) та реальними можливостями протоколу (fencing лише для Git publish), а також кілька архітектурних суперечностей і прогалин у специфікації.

## Considered Options
* Відхилити зауваження як некритичні
* Прийняти зауваження і виправити специфікацію

## Decision Outcome
Chosen option: "Прийняти зауваження і виправити специфікацію", because всі 10 зауважень були технічно коректними або потребували уточнення defense-in-depth; жодне не було відхилено без змін.

### Consequences
* Good, because transcript фіксує очікувану користь: усунено суперечності між guarantee-термінологією та фактичними можливостями протоколу; специфікація тепер точно відображає single-publish-owner семантику.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

**Зміна 1 — Single publish owner (зауваження 1):**
- Перейменовано гарантію з "mutual exclusion" на "single publish owner" у трьох місцях: секція Fencing, рядок "Protocol гарантує…", рядок таблиці summary.
- Додано параграф "Межа fencing — лише Git publish" із вимогами idempotency key / `generation` fencing token для зовнішніх side effects; заборона auto-takeover для задач із non-idempotent side effects.

**Зміна 2 — TOCTOU у Protected-main fallback (зауваження 2):**
- Прибрано залежність від GitHub Merge API повністю.
- Integration bot тепер виконує `git push --atomic` із тими ж `--force-with-lease` що й direct publisher (3 refs: `main`, claim ref, run ref).
- PR залишається виключно approval interface; merge виконується fenced bot push.

**Зміна 3 — Differential cascade суперечить invalidate (зауваження 3):**
- `mt invalidate` тепер архівує лише target вузол; нащадки не архівуються одразу.
- Cascade відкладений (deferred by default): нащадки переходять у `blocked` (їх `fact_*.md` не чіпаються). Після re-run `mt done` порівнює hash нового факту: однаковий → нащадки розблоковуються без архівації; різний → `mt invalidate` по нащадках рекурсивно.
- `mt kill` явно позначений як eager cascade (завжди видаляє downstream через `git rm`).

**Зміна 4 — Patch protocol: `mt kill` → `mt stop` + `mt invalidate` (зауваження 4):**
- `mt kill` тепер є виключно семантичним kill (archive + git rm). Кроки SIGTERM/claim-release прибрані.
- Додана нова команда `mt stop`: зупиняє процес (SIGTERM) + CAS-видаляє claim + прибирає worktree; topology і facts не чіпає.
- Patch protocol оновлено: `mt stop` наступників → `mt invalidate` цільового вузла → патч → publish.
- `mt kill` перевіряє відсутність активних claims перед запуском (error без `--force`).

**Зміна 5 — `generation` у fencing (зауваження 5):**
- `generation` вже був у рядку 181 специфікації; зауваження частково помилкове.
- Додано пояснення двох рівнів fencing: Git-layer (force-with-lease, лише claim_sha — достатньо через content-addressing) та software-layer (defense-in-depth: перевірка claim_sha + token + generation + lease_until).

**Зміна 6 — `node_hash` у claim schema (зауваження 6):**
- Додано поле `node_hash: <sha256(node-path)>` у claim schema.
- Software-layer fencing розширено двома перевірками: `node_hash == sha256(node:)` (self-consistency) та `node_hash == hash із ref-шляху` (ref binding).

**Зміна 7 — Прибрано `run_ref` зі схеми (зауваження 7):**
- `run_ref` видалено з claim schema як надлишкове поле.
- Додана нотатка: runner будує ref сам: `refs/mt/runs/<node_hash>/<token>`.

**Зміна 8 — Документування `base_sha` (зауваження 8):**
- `base_sha` залишено в схемі (використовується у рядках 1098 і 1147 для `git worktree add --detach`).
- Додано inline-коментар у YAML: "SHA origin/main на момент acquisition; використовується для git worktree add --detach".

**Зміна 9 — Grace period явна специфікація (зауваження 9):**
- Додано таблицю з трьома фазами claim lifecycle: active lease / grace period / stalled.
- Явно перелічено: що дозволено (renewal оригінального runner під час grace), що заборонено (takeover, нові runners під час grace).

**Зміна 10 — `schema_version` у `.mt.json` (зауваження 10):**
- Додано `schema_version: 1` першим полем у `.mt.json`.
- Додано правило: оркестратор відмовляє запускатись при відсутньому або невідомому `schema_version`.
