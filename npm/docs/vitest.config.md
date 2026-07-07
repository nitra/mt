---
type: JS Module
title: vitest.config.js
resource: npm/vitest.config.js
docgen:
  crc: 5043a576
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Overview: Файл виконує запуск тестів з файлів `*.test.{js,mjs}` та top-level integration suites у директорії `tests`. Інструмент забезпечує безпеку та надійність тестування шляхом виключення директорій `node_modules`, `dist` та `reports/stryker` з процесу тестування.

## Поведінка

Поведінка

1. Запускає тести з файлів `*.test.{js,mjs}` та top-level integration suites у `tests/`
2. Виключає з тестування директорії `node_modules`
3. Виключає з тестування директорії `dist`
4. Виключає з тестування директорії `reports/stryker`
5. Використовує ізоляцію процесів через `forks` для гарантування безпеки від випадкової зміни робочої директорії

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Свідомо пропускає шляхи: `node_modules`.
