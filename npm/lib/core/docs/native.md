---
type: JS Module
title: native.mjs
resource: npm/lib/core/native.mjs
docgen:
  crc: 40b02742
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Огляд
Файл визначає та завантажує нативний модуль. Визначає, як шукати та ініціалізувати клієнт Rust-ядро `mt-core`.

## Поведінка

Поведінка
resolveNativeAddon: Резолвить шлях до napi-аддона mt.
loadNative: Завантажує аддон за шляхом через process.dlopen.

## Публічний API

**resolveNativeAddon**: Резолвить шлях до napi-аддона `mt`.
  env?: Record<string, string | undefined>,
  platform?: string,
  arch?: string,
  existsSync?: (p: string) => boolean,
  requireResolve?: (id: string) => string,
  repoRoot?: string

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Кешує результати в межах одного прогону.
