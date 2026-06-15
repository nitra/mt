# Changelog

## [0.4.2] - 2026-06-15

### Changed

- відповідь на рецензію mt.md (9 вирішено, 4 misread): single publish owner, deferred cascade, fenced bot push, dep addressing, cleanup command

## [0.4.1] - 2026-06-14

### Changed

- Прибрано дублювання audit/done/failed (спільний core/task-command.mjs: writeRunFile+resolveTaskPath); видалено мертвий export hasPendingAudit; jscpd ігнорує tooling-дзеркала й markdown.

## [0.4.0] - 2026-06-14

### Changed

- init: створення задачі делеговано Rust-бінарнику mt-scanner (mt-scanner create); прибрано JS-авторинг task.md (buildTaskFrontMatter). Виконавець визначає прапор a.md/h.md; валідація імен у Rust+JS зі спільними тест-векторами.

## [0.3.1] - 2026-06-13

### Changed

- Уточнення протоколу mt.md: single publish owner, deferred cascade, GC refs, spawn failure handling, recovery tree, claim_grace_sec limits, integration bot atomic push
- npm/docs/mt.md: dep-id завжди абсолютний від tasks-root; deps/ дзеркалює структуру mt/; виправлено неоднозначну "sibling shorthand" адресацію
- npm/docs/mt.md: mt done/mt audit — integrity check task.md/a.md/h.md проти origin/main і ephemeral file guard для run-draft.md (git diff --cached)
- npm/docs/mt.md: schema_version backward compatibility — orchestrator читає всі відомі версії, відмовляє лише майбутні
- npm/docs/mt.md: mt invalidate зупиняє running процес внутрішньо (SIGTERM + CAS-delete claim); patch protocol виправлено — mt kill замінено на mt invalidate
- npm/docs/mt.md: новий розділ "Ролі: Orchestrator і Runner" з описом distributed deployment

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
