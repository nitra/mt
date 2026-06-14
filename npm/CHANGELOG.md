# Changelog

## [0.4.0] - 2026-06-14

### Changed

- init: створення задачі делеговано Rust-бінарнику mt-scanner (mt-scanner create); прибрано JS-авторинг task.md (buildTaskFrontMatter). Виконавець визначає прапор a.md/h.md; валідація імен у Rust+JS зі спільними тест-векторами.

## [0.3.1] - 2026-06-13

### Changed

- Уточнення протоколу mt.md: single publish owner, deferred cascade, GC refs, spawn failure handling, recovery tree, claim_grace_sec limits, integration bot atomic push

## [0.3.0] - 2026-06-13

### Changed

- scanner делегує сканування Rust-бінарнику mt-scanner; prebuilt-бінарники через optionalDependencies (@7n/mt-darwin-arm64, @7n/mt-linux-x64)

## [0.2.0] - 2026-06-11

### Added

- додано standalone Meta-task CLI, файловий runtime і task orchestration

### Changed

- mt.md: редизайн специфікації — derived-стани (failed_streak, unresolvable), блокуючий аудит-гейт з clarification-циклом, plan-review через ## Children, retry ladder, inline-фаза планування, security model, cost ledger, наскрізний приклад

### Fixed

- опубліковано повний TypeScript declaration graph для re-exported API `@7n/mt`
