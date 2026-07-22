---
type: JS Module
title: config.mjs
resource: npm/lib/core/config.mjs
docgen:
  crc: 81739452
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Завантаження конфігурації `.mt.json` для mt-команд (читання файлу з ін'єктованою ФС, злиття з дефолтами у Rust-ядрі `mt-core` через napi-аддон) плюс **user-level конфіг виконавців з ENV** — він спільний для всіх репозиторіїв користувача і тому не живе у repo-scoped `.mt.json`.

## Публічний API

- `CONFIG_DEFAULTS` — дефолтні значення конфігурації (джерело істини — Rust `config_defaults`); модельних ключів не містить.
- `loadConfig({ root, readFile, exists })` — читає `<root>/.mt.json` (якщо існує) і повертає злиту з дефолтами конфігурацію.
- `resolveMtDir(config, root)` / `resolveWorktreesDir(config, root)` — абсолютні шляхи до `mt_dir` / `worktrees_dir` (відносні — від `root`).
- `normalizeModelTier(tier)` — канонізація тиру (uppercase: `MIN` | `AVG` | `MAX`).
- `loadAgentCliEnv(env)` — конфіг виконавців з ENV: `MT_AGENT_CLI` (дефолтний CLI, fallback `claude`), `MT_CLOUD_AGENT_CLIS` (каскад хмарних CLI, comma-separated), `MT_AGENT_CLI_MODEL_MAP` (JSON-мапа «CLI → тир → модель»; невалідний JSON → порожня мапа без винятку).
- `resolveModelForCli(cliEnv, agentCli, modelTier)` — конкретна модель тиру для підписочного CLI з мапи; немає мапінгу → `null` (CLI резолвить модель сам, тир лишається hint-ом `MT_MODEL_TIER`).

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- ФС і ENV ін'єктуються — модуль тестований без диска й реального оточення; відсутній `.mt.json` → чисті дефолти.
