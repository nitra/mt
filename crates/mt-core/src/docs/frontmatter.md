---
type: Rust Module
title: frontmatter.rs
resource: crates/mt-core/src/frontmatter.rs
docgen:
  crc: 0cc51d2c
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Файл надає інструменти для роботи з YAML front-matter у task-файлах. Він забезпечує ідентичність вихідного байта між парсером та серіалізатором, зберігаючи порядок ключів.

## Поведінка

Поведінка
parse_front_matter: Парсить YAML front-matter з markdown-тексту
parse_yaml: Парсить чистий YAML-блок
get_body: Повертає тіло документа без front-matter з обрізаним лівим whitespace
serialize_yaml: Серіалізує об'єкт у YAML-рядок
build_markdown: Будує markdown-файл із front-matter та тілом

## Публічний API

Я готовий переписати список функцій відповідно до ваших вимог. Будь ласка, надайте список, який потрібно переписати.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
