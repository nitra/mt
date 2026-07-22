---
type: JS Module
title: run.mjs
resource: npm/lib/commands/run.mjs
docgen:
  crc: 0b4eee0d
  model: omlx/gemma-4-e2b-it-4bit
  score: 95
---

## Огляд

Обробник команди `mt run [<path>] [--actor a] [--auto]` — запуск задачі (або всіх готових задач) в ізольованому git worktree з обраним виконавцем і фіксацією результату артефактами `run_NNN.md`/`fact_NNN.md`.

## Поведінка

1. Читає `task.md` вузла: `budget_sec`, `budget_hard_sec`, `deps`, `mode`, `executor`; для конкретного шляху перевіряє, що всі `deps` розв'язані.
2. Обчислює `NNN` наступного run і номер спроби `MT_ATTEMPT = failed_streak + 1`; резолвить щабель драбини ретраїв (`## Retry ladder` з `a.md` або дефолт base → diagnose-first → alternative-approach) у стратегію `MT_RETRY_STRATEGY` та ескалацію `model_tier` (MIN→AVG→MAX, cap на MAX).
3. Резолвить виконавця: `model_tier` — секція `## Model tier` у `a.md` → frontmatter → `default_model_tier`; підписочний CLI — секція `## Agent cli` у `a.md` (per-node) → user-level env `MT_AGENT_CLI` → `claude`. Невідомий `agent_cli` → відмова fail-fast ще до створення worktree.
4. Створює worktree `.worktrees/<task-epoch>/` (атомарний mkdir-lock; існує → задача вже запущена, skip).
5. Передає контекст env-змінними: `MT_RUN_NNN`, `MT_ATTEMPT`, `MT_RETRY_STRATEGY`, `MT_BUDGET_SEC`, `MT_HARD_BUDGET_SEC`, `MT_STARTED_AT`, `MT_TASK_PATH`, `MT_NODE_DIR`, `MT_WORKTREE`, `MT_RUN_TOKEN`, `MT_MODEL_TIER`, `MT_AGENT_CLI`.
6. Спавнить виконавця (синхронно, з hard-timeout за `budget_hard_sec`):
   - **підписочний CLI** (єдиний agent-шлях) — headless-запуск за таблицею `AGENT_CLIS`: `claude --model … --no-session-persistence -p`, `codex exec -m … --sandbox workspace-write --ephemeral`, `cursor-agent --model … --print --force`, `pi --model … --no-session -p` (локальні omlx-моделі через pi.dev CLI); конкретну модель тиру резолвить user-level env `MT_AGENT_CLI_MODEL_MAP[<cli>][tier]`; без мапінгу прапор моделі не передається — CLI резолвить сам за підпискою користувача, тир завжди йде hint-ом `MT_MODEL_TIER`. Якщо результат схожий на вичерпані ліміти підписки (rate limit / quota / 429 у виводі), спрацьовує **каскад** env `MT_CLOUD_AGENT_CLIS`: наступний хмарний CLI у порядку `[обраний, ...каскад]` без дублів, модель — per-кандидат; фактичний CLI пишеться у frontmatter `run_NNN.md` (`agent_cli`); не-лімітні помилки каскад не запускають;
   - **human** — виводить інструкції для ручного виконання і завершується без run-артефакту.
7. Визначає результат: success = `fact_NNN.md` існує **і** всі команди секції `## Check` завершились exit 0; інакше failed.
8. Пише `run_NNN.md` (success — у worktree, failed — у main-checkout, бо діагностичний worktree лишається незмердженим); за success мержить worktree у main і видаляє його, за failed зберігає worktree для діагностики.
9. Режим `--auto` сканує граф на готові задачі (`waiting` + resolved deps, топологічний порядок) і запускає кожну; перед запуском діють ліміт `max_worktrees` і попередження `warn_worktrees_above`.

## Гарантії поведінки

- ФС і `child_process` ін'єктуються залежностями — модуль тестований без реального диска і процесів.
- Помилки читання/створення worktree/запису артефактів не пропускаються назовні винятками: логуються і повертається код помилки.
- Невідомий actor або `agent_cli` — явна відмова з підказкою підтримуваних значень.
