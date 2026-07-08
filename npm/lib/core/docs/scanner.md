---
type: JS Module
title: scanner.mjs
resource: npm/lib/core/scanner.mjs
docgen:
  crc: 3a213b2f
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Модуль надає інструменти для роботи з DAG-сканером задач, який виконує тонкий шим над Rust-ядром `mt-core`. Файл забезпечує перетворення JSON-дерева задач у плоский контракт команд та виконання топологічного сортування.

## Поведінка

Поведінка

findTasks
Переводить JSON-дерево задач у плоский контракт команд

scanTasks
Запускає бінарник для сканування та повертає список задач

topoSort
Виконує топологічне сортування задач для визначення порядку виконання

areDepsResolved
Перевіряє, чи всі залежності для задачі є resolved

getActiveWorktrees
Отримує список активних worktrees з git worktree list

parseWorktreeList
Парсить вивід git worktree list у набір імен worktree

## Публічний API

findTasks — знаходить усі задачі DAG у mt\_dir.
scanTasks — сканує DAG і повертає всі задачі з деривованими станами, включаючи blocked та worktree $\rightarrow$ running, обчислюючи бінарник.
topoSort — виконує топологічне сортування задач (алгоритм Кана). Задачі без залежностей виконуються першими. Циклічні залежності не гарантуються.
areDepsResolved — перевіряє, чи всі залежності задачі resolved.
getActiveWorktrees — знаходить активні worktrees з git worktree list.
parseWorktreeList — парсить вивід `git worktree list --porcelain` і повертає набір імен worktree.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
