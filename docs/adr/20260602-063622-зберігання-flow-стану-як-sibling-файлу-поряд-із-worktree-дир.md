---
session: 6fe23dd0-c98a-4062-9d55-2dc4ce97b956
captured: 2026-06-02T06:36:22+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/6fe23dd0-c98a-4062-9d55-2dc4ce97b956.jsonl
---

## ADR Зберігання flow-стану як sibling-файлу поряд із worktree-директорією

## Context and Problem Statement
`mt audit` потребує метаданих про ізольовану задачу (зокрема `base_commit`). Питання сесії: де цей стан живе і чи достатньо мати worktree, створений напряму через `worktree add`, без попереднього `mt init`.

## Considered Options
* Зберігати стан у файлі всередині самої worktree-директорії
* Зберігати стан як **sibling-файл** `.worktrees/<sanitized-branch>MT file-presence state поруч із worktree-директорією

## Decision Outcome
Chosen option: "sibling-файл `.worktrees/<sanitized-branch>MT file-presence state", because `lib/state-store.mjs` явно описує: стан кладеться поруч із директорією, а не всередині неї — директорія `.worktrees/feat-x` → стан `.worktrees/feat-xMT file-presence state.

### Consequences
* Good, because стан залишається доступним навіть якщо worktree-директорію видалено або не змонтовано — `mt audit` може перечитати `base_commit` незалежно від git-checkout стану.
* Bad, because worktree, створений напряму через `n-cursor worktree` чи `git worktree add` без `mt init`, не матиме MT file-presence state-файлу, і `mt audit` не зможе знайти необхідний стан.

## More Information
- `npm/scripts/dispatcher/lib/state-store.mjs` — опис конвенції sibling-файлу (рядки 4–7)
- `npm/scripts/dispatcher/lib/commands.mjs` — `mt init` (§8.1): worktree + ініціалізація стану одночасно; виклик `worktreePaths` + `worktreeFingerprint`
- `npm/scripts/dispatcher/lib/review.mjs` — `mt audit` читає `base_commit` зі стану; adversarial-субагент аналізує `git diff base_commit`
- Прямий виклик `n-cursor worktree add` (без `mt init`) не створює MT file-presence state → `mt audit` завершиться помилкою відсутнього стану
