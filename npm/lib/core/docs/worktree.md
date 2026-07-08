---
type: JS Module
title: worktree.mjs
resource: npm/lib/core/worktree.mjs
docgen:
  crc: 32cfa254
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Огляд
Файл керує Git worktree для системи завдань. Відповідає за створення, видалення та злиття ізольованих робочих директорій, використовуючи механізм блокування для атомарності операцій.

## Поведінка

Поведінка
makeWorktreeName
Генерує ім'я worktree для задачі
createWorktree
Створює git worktree для задачі з atomic mkdir lock
removeWorktree
Видаляє git worktree
mergeWorktree
Мерджить зміни з worktree у main-гілку і видаляє worktree
listActiveWorktrees
Повертає список активних worktrees з репо
findTaskWorktree
Знаходить worktree що належить задачі за prefix

## Публічний API

- makeWorktreeName — генерує ім'я для worktree.
- createWorktree — створює git worktree з atomic mkdir lock для задачі. Повертає `null` якщо worktree вже існує (EEXIST → вже запущено).
- removeWorktree — видаляє git worktree.
- mergeWorktree — мержить зміни з worktree у main-гілку і видаляє worktree.

## Гарантії поведінки

- Кешує результати в межах одного прогону.
