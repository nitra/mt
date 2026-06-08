---
session: 6fe23dd0-c98a-4062-9d55-2dc4ce97b956
captured: 2026-06-05T10:10:49+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6fe23dd0-c98a-4062-9d55-2dc4ce97b956.jsonl
---

## ADR `mt init` як мінімально необхідний старт для flow-турнікета

## Context and Problem Statement
У проєкті є дві точки входу для створення ізольованого worktree: `n-cursor worktree add` і `mt init`. Питання постало, бо worktree, створений напряму через `worktree add`, не мав flow-стану — і `mt audit` падав із «стану нема». Потрібно було зрозуміти різницю й полагодити без перестворення worktree.

## Considered Options
* `mt init` зсередини вже наявного worktree (виявлено через `isLinkedWorktree` → пропускає `worktree add`, лише дописує MT file-presence state)
* Видалити worktree й перестворити через `mt init` з нуля

## Decision Outcome
Chosen option: "Виклик `mt init` зсередини наявного worktree", because `ensureWorktree` в `commands.mjs:76-77` детектує `isLinkedWorktree(cwd)` і не вкладає новий worktree — натомість лише записує MT file-presence state поруч (`.worktrees/<branch>.mt-state.json`), зберігаючи незакомічену роботу.

### Consequences
* Good, because transcript фіксує очікувану користь: незакомічені зміни збережено, стан записано (`level 1, risk low`), `mt audit` підхопив MT file-presence state і відпрацював із 11 findings.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/dispatcher/lib/commands.mjs:76-90` — `ensureWorktree`, перевірка `isLinkedWorktree`
- `npm/scripts/dispatcher/lib/state-store.mjs:4-7` — стан лежить як sibling-файл `.worktrees/<sanitized-branch>MT file-presence state
- `npm/scripts/dispatcher/lib/review.mjs:116-121` — `readState` на старті `mt audit`, exit 1 при відсутньому стані
- Команда відновлення стану: `cd .worktrees/feat-coverage-changed-gate && npx @nitra/cursor mt init feat/coverage-changed-gate "<опис>"`
