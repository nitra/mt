---
type: JS Module
title: scanner-bin.mjs
resource: npm/lib/core/scanner-bin.mjs
docgen:
  crc: 1f360412
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Огляд: Файл визначає точний шлях до бінарника `mt-scanner` через послідовний пошук. Пошук починається з явного перекриття `MT_SCANNER_BIN` (для dev/CI/тестів), потім переходить до підпакетів `@7n/mt-<platform>-<arch>` (як опціональних залежностей), а потім використовує fallback у вигляді `<repoRoot>/target/release|debug/mt-scanner`. Результат кешується.

## Поведінка

Поведінка

resolveScannerBin Резолвить абсолютний шлях до бінарника mt-scanner.
scannerBin Повертає кешований шлях до бінарника mt-scanner.

## Публічний API

**resolveScannerBin** — резолвить повний шлях до бінарника `mt-scanner` з налаштуваннями.
**scannerBin** — кешований резолвер, який замінюється через `resolveScannerBin` для тестування.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
