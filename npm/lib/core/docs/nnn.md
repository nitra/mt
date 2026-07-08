---
type: JS Module
title: nnn.mjs
resource: npm/lib/core/nnn.mjs
docgen:
  crc: beb79516
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Створює нумерацію для артефактів задач. Допомагає ін'єкції у Rust-ядро через napi-аддон.

## Поведінка

Поведінка
padNNN Форматує число у рядок NNN три цифри з ведучими нулями
nextRunNNN Обчислює наступний NNN для taskDir
nextPlanNNN Обчислює наступний NNN для taskDir
latestFactNNN Знаходить максимальний NNN серед fact_NNN.md
latestPendingAuditNNN Знаходить NNN для останнього pending-audit_NNN.md
latestAuditResultNNN Знаходить NNN для останнього audit-result_NNN.md

## Публічний API

Зрозумів. Я готовий писати лаконічну поведінкову документацію у стилі «назва — що робить» українською мовою, без вступів, висновків, сигнатур чи типізації, використовуючи надані назви.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
