---
schema_version: 1
created_at: 2026-07-12T16:11:10.439Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `js` (concern `eslint`), які не закрила інлайн fix-драбина.

## Done when

- `js` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @nitra/cursor lint --no-fix --cwd ../.. js

## Inputs

Target-файли:

- `npm/lib/commands/run.mjs`
- `npm/lib/tests/run.test.mjs`
