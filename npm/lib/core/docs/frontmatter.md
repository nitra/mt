---
type: JS Module
title: frontmatter.mjs
resource: npm/lib/core/frontmatter.mjs
docgen:
  crc: e70b95df
  model: omlx/gemma-4-e2b-it-4bit
  score: 100
---

## Огляд

Огляд
Файл надає інструменти для парсингу та серіалізації YAML front-matter для task-файлів. Забезпечує ідентичність вихідних байтів між Rust-реалізацією та історичною JS-реалізацією, підтримуючи прості пари ключ-значення, вкладені об'єкти з відступами та серіалізацію назад у YAML для запису.

## Поведінка

Поведінка

parseFrontMatter Парсить YAML front-matter з markdown-тексту повертає словник з ключа-значення або порожній об'єкт якщо front-matter відсутній

getBody Отримує тіло документа без front-matter

serializeYaml Серіалізує об'єкт у YAML-рядок для front-matter

buildMarkdown Будує markdown-файл з front-matter та тілом

## Публічний API

Зрозуміло. Я готовий переписати цей список відповідно до ваших вимог, виконуючи роль технічного письменника.

Ось переписаний список у потрібному форматі:

- parseFrontMatter — Парсить YAML front-matter з markdown-тексту. Повертає словник (може містити вкладені об'єкти та масиви).
- getBody — Отримує тіло документа (без front-matter).
- serializeYaml — Серіалізує об'єкт у YAML-рядок (для front-matter). Підтримує прості scalar, масиви та вкладені об'єкти.
- buildMarkdown — Створює markdown-файл із front-matter і тілом.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
