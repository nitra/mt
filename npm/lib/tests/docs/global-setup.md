---
type: JS Module
title: global-setup.mjs
resource: npm/lib/tests/global-setup.mjs
docgen:
  crc: 565d7025
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Файл забезпечує наявність Rust-артефактів — CLI-бінарника `mt-scanner` та napi-аддона `mt-napi`, необхідних для роботи `scanner.mjs` / `native.mjs`. Файл гарантує їх наявність для коректної роботи резолверів через dev-fallback у `<repoRoot>/target/release` або при збірці в чистому checkout.

## Поведінка

Поведінка

1. Перевірити наявність бінарника `mt-scanner`
2. Перевірити наявність аддона `mt-napi`
3. Якщо бінарники відсутні, запустити збірку через `cargo build --release -p mt-cli -p mt-napi` у корені репозиторію

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
