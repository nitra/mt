## ADR Явне розмежування ролей Orchestrator і Runner в MT

**Status:** Accepted
**Date:** 2026-06-13

## Context and Problem Statement

`npm/docs/mt.md` вживав терміни "orchestrator" і "runner" без чіткого визначення меж між ними. Системи типу Apache Airflow явно розділяють scheduling (orchestrator) і execution (runner/worker). Документ не фіксував: це одна роль чи дві, один binary чи різні, чи підтримується distributed deployment з runner-ами на окремих машинах.

## Considered Options

* Залишити неявне розмежування (поточний стан)
* Явно описати дві ролі, поточну реалізацію (один `mt` binary, два subcommands) і підтримку distributed deployment через fencing-протокол

## Decision Outcome

Chosen option: "явне документування двох ролей", because fencing-протокол (remote claim validation, lease renewal, CAS через Git refs) побудований так що runner може виконуватись на окремій машині від watch. Дизайн підтримує горизонтальне масштабування runner-ів, але це ніде не було зафіксовано, що залишало архітектурне рішення прихованим.

### Consequences

* Good, because чіткі межі між scheduling і execution; документально підтверджено що кілька runner-ів можуть паралельно виконувати різні вузли під одним watch-процесом; deployment topology зрозуміла для нових розробників.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Додано: `npm/docs/mt.md` — новий розділ "Ролі: Orchestrator і Runner" (~рядок 812, перед CLI контрактом). Секція описує: `mt watch` як scheduling-процес, `mt run` як execution-процес, поточну реалізацію (один binary), distributed deployment (runner на окремій машині через fencing), горизонтальне масштабування (кілька runner-ів, один watch, CAS claim гарантує single runner per node).
