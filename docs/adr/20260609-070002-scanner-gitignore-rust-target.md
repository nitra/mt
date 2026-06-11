# Ігнорування артефактів Rust-сканера в `.gitignore`

**Status:** Accepted
**Date:** 2026-06-09

## Context and Problem Statement
До репозиторію `mt` додано Rust-проєкт `scanner/` (бінарний крейт `mt-scanner`). Директорія `scanner/target/` містить артефакти компіляції і не повинна потрапляти до git, але до цього моменту `.gitignore` не мав жодного правила для Rust.

## Considered Options
- Додати `scanner/target/` до кореневого `.gitignore`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `scanner/target/` до кореневого `.gitignore`", because `target/` — стандартний каталог білд-артефактів Rust і його виключення є загальноприйнятою практикою; `Cargo.lock` навмисно залишається незаігнорованим, оскільки для бінарного крейту він фіксує точні версії залежностей і забезпечує відтворюваність білдів.

### Consequences
- Good, because `scanner/target/` більше не відстежується git і не забруднює `git status` / `git diff`.
- Good, because `Cargo.lock` закомічений — відтворювані білди бінарника гарантовані.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `.gitignore`
- Додано правило: `scanner/target/`
- `scanner/Cargo.toml`: пакет `mt-scanner`, edition 2021, `[[bin]]` → бінарний крейт.
- Рішення щодо `Cargo.lock` базується на офіційній рекомендації Rust/Cargo для бінарних крейтів.
