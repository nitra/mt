---
schema_version: 1
created_at: 2026-07-11T11:05:01Z
budget_sec: 3600
hint: atomic
---

## Mission

Фінал міграції frozen-контракту: видалити `npm/docs/mt.md` (0.2.x) — runtime-шар реалізує протокол v4 (`agent-protocol` + `agent-server`), унікальний нормативний зміст уже перенесено в канон architecture/ (аудит 2026-07-11). Оновити всі посилання й тест канонічної специфікації.

## Done when

- `npm/docs/mt.md` видалено;
- посилання оновлені: `npm/docs/index.md` (секція «Чинний контракт 0.2.x»), `npm/docs/architecture/index.md`, `npm/docs/architecture/overview.md` — згадки 0.2.0 стають історичними, без мертвих лінків;
- `npm/lib/tests/docs.test.mjs`: перевірка legacy-імен переорієнтована з mt.md на всі md-файли `npm/docs/` (architecture + index) — тест зелений;
- запис у `npm/docs/log.md`;
- `vitest run` зелений; жодного `](mt.md)`/`](../mt.md)` у npm/docs.

## Context

- Гейт із банера mt.md: «буде видалено на milestone M1, коли runtime-шар реалізує протокол v4» — виконується задачами m1-agent-protocol/m1-agent-server.
- Перенесений зміст: ENV-контракт wrapper→агент (git.md), «Контекст агента» (graph.md), канон конфіг-дефолтів (operations.md) — PR #24.
