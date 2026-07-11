---
type: Rust Module
title: runner.rs
resource: crates/agent-server/src/runner.rs
docgen:
  crc: a4511381
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Міст між клієнтським `UserMessage` і `agent-core`: `UserMessage` запускає хід агента, а всі події цього ходу емітяться в сесію, яку збирає session host через `Envelope`. Референсна реалізація — `AgentTurnRunner` поверх `agent_core::Agent` з будь-яким `Provider`; `EchoTurnRunner` — заглушка для demo/CLI без налаштованого провайдера. `TurnRunner`, `AgentTurnRunner`, `new`, `EchoTurnRunner` — публічні точки входу модуля. Файл read-only: не пише у ФС чи БД; за окремих помилок повертає порожнє значення (`null`) замість винятку.

## Поведінка

- **TurnRunner** — запускає один хід кімнати, емітить події ходу в сесію і повертає відповідь агента.
- **AgentTurnRunner** — керує окремим `agent-core`-агентом для кожної кімнати, щоб зберігати історію між ходами.
- **new** — створює `AgentTurnRunner` на основі фабрики агента для конкретної кімнати.
- **EchoTurnRunner** — віддзеркалює текст користувача для demo/CLI без налаштованого провайдера і для тестів транспорту.

## Публічний API

TurnRunner — запускає один хід у кімнаті й повертає результат відповіді.

AgentTurnRunner — веде окремого `Agent` для кожної кімнати, щоб не змішувати історії між кімнатами.

new — через `factory` збирає агента кімнати з system prompt, tools і моделлю.

EchoTurnRunner — без LLM повертає назад текст користувача; корисний для demo `attach` без provider і для transport-тестів.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
