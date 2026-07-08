---
type: JS Module
title: task-command.mjs
resource: npm/lib/core/task-command.mjs
docgen:
  crc: a2123748
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Огляд: Файл містить спільні хелпери для команд переходу стану задачі. Він існує для уникнення дублювання логіки, забезпечуючи єдине джерело формату `run_NNN.md` та резолв шляху задачі.

## Поведінка

writeRunFile
Пише артефакт run\_NNN.md з використанням формату `run_NNN.md`

resolveTaskPath
Резолвить шлях задачі з аргументів або env MT\_TASK\_PATH

## Публічний API

writeRunFile — Пише артефакт run\_NNN.md.

resolveTaskPath — Визначає шлях до завдання через аргументи або `MT_TASK_PATH` змінну середовища.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
