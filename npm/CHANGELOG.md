# Changelog

## [0.24.1] - 2026-07-12

### Changed

- feat(M2): ws-рівень кооперативного handoff — seed_journal + AppState API (#40)

## [0.24.0] - 2026-07-12

### Changed

- Нема змін у коді
- Нема змін у коді
- Нема змін у коді
- Нема змін у коді
- Нема змін у коді

## [0.23.0] - 2026-07-12

### Changed

- Нема змін у коді
- Нема змін у коді
- Нема змін у коді
- Нема змін у коді
- Нема змін у коді

## [0.22.0] - 2026-07-12

### Changed

- Нема змін у коді
- Нема змін у коді
- Нема змін у коді
- Нема змін у коді

## [0.21.0] - 2026-07-12

### Changed

- Нема змін у коді
- Нема змін у коді
- Нема змін у коді

## [0.20.0] - 2026-07-12

### Changed

- Нема змін у коді
- Нема змін у коді

## [0.19.0] - 2026-07-12

### Changed

- Нема змін у коді

## [0.18.0] - 2026-07-11

### Changed

- Нема змін у коді
- Нема змін у коді

## [0.17.0] - 2026-07-11

### Changed

- Нема змін у коді

## [0.16.0] - 2026-07-11

### Changed

- docs(runtime.md): протокол v4 — мінорне розширення Event: `DoneSession {}` (завершити run — fenced publish fact) і `ReleaseSession {}` (пауза — CAS-delete claim, журнал лишається в run ref)

## [0.15.0] - 2026-07-11

### Added

- ✨ feat(runner): точка розширення `node_executor` — виконання вузла зовнішньою командою замість вбудованого Claude-шляху (тир-канон через MT_MODEL_TIER, ## Check + синтез fact лишаються за MT)

## [0.14.3] - 2026-07-11

### Changed

- ✨ feat(agent-server): graph-міст — інтерактивний run вузла поверх mt-core (M1) (#28)

## [0.14.2] - 2026-07-11

### Changed

- 📝 docs(adr): нормалізація чернеток — консолідація 10 драфтів у 3 фінальні записи (#21)

## [0.14.1] - 2026-07-11

### Changed

- 📝 docs(adr): нормалізація чернеток — консолідація 10 драфтів у 3 фінальні записи (#21)

## [0.14.0] - 2026-07-08

### Changed

- chore: .mt.json закомічено (схема в @nitra/cursor 14.12.1), бамп @nitra/cursor, oxfmt у hk-ланцюжку npm-tsc-types

## [0.13.0] - 2026-07-08

### Changed

- docs: retro.md — інновації з baseline та impact-вимірюванням, заохочення людей (профіль вкладу) і агентів (відбір); roadmap M5 impact-критерій

## [0.12.0] - 2026-07-08

### Added

- docs: глава retro.md (мета-цикл) + M5 у roadmap; M0 dogfood: mt/ ініціалізовано, перша задача m1-agent-protocol

## [0.11.1] - 2026-07-08

### Added

- docs: файлові поведінкові доки (`<dir>/docs/<stem>.md`) для 47 кодових файлів — згенеровано локальним docgen-конвеєром; нотатка про upstream-баг rollback-у lint doc-files (nitra/cursor#16)

## [0.11.0] - 2026-07-08

### Changed

- docs: пакет рішень по 12 відкритих питаннях — нові surfaces.md і roadmap.md, протокол v4 (lang), гібридний live-i18n, checkpoint-handoff, життєвий цикл ключів, design envelope
- docs: курування — видалено review-response.md і mt-impl.md (приклад перенесено у graph.md + 0.3.0-продовження), mt.md заморожено; додано глосарій, конфіг-довідник, trust-матрицю, протокольні помилкові гілки, схему mcp_servers, розділ «Ніша»

### Fixed

- CI: n-cursor lint ga/text (новий синтаксис CLI), eslint-помилки unicorn у lib, стабілізація rmSync у тестах, лічильник ADR 175

## [0.10.0] - 2026-07-07

### Changed

- docs: vision — мета-цикл ретроспективного самопокращення процесу (аналіз audit trail, пропозиції кращих skills/інструментів)

### Fixed

- CI: n-cursor lint ga/text (новий синтаксис CLI), eslint-помилки unicorn у lib, стабілізація rmSync у тестах, лічильник ADR 175

## [0.9.0] - 2026-07-07

### Added

- docs: глава архітектури i18n.md — багатомовність (base-канон, derived-переклади у refs/mt/i18n, worktree-матеріалізація, contract-aware перекладач)

## [0.8.0] - 2026-07-07

### Added

- docs: зафіксовано мету проєкту (vision.md) — платформа задач для людей і ШІ, пʼять крос-вимірів

## [0.7.0] - 2026-07-07

### Changed

- docs: об'єднана цільова архітектура 0.3.0-draft — мердж графа задач mt.md і scaffold-spec v4 (пристрої/сесії/relay); реструктуризовано у глави docs/architecture/ з OKF-індексами (docs/index.md, docs/log.md) та frontmatter; mt.md позначено deprecated як цільова картина, лишається контрактом @7n/mt@0.2.x

## [0.6.0] - 2026-07-04

### Changed

- Ядро (nnn, frontmatter, state, config, worktree, scanner) перенесено в Rust-крейт mt-core; lib/core — тонкі обгортки над napi-addon (native.mjs loader), vitest-сюїта як conformance gate

## [0.5.1] - 2026-06-18

### Fixed

- worktree: lint-чистота нового `mt worktree` (oxlint+eslint) — повний JSDoc, case-дужки, `catch error`, `Object.hasOwn`, static regex, noop-мок. Файл уперше проходить CI-лінт (раніше був untracked). Поведінка незмінна, 17/17 тести.

## [0.5.0] - 2026-06-18

### Changed

- worktree: dev-команду вирівняно під контракт worktree-lifecycle (спека cursor docs/specs/2026-06-16-worktree-lifecycle-to-mt.md) — `@7n/mt` стає власником worktree-керування, на яке спиратиметься `@nitra/cursor`. Без зворотної сумісності: `add` → `create`; додано `prune` (прибрати осиротілі інвентарі) та `inventory` (JSON-стан для task-graph); інвентар перенесено у `<worktrees_dir>/.meta/<sanit>.md` (тепер `.worktrees/` містить лише worktree-каталоги + `.meta/`); `create` отримав `firstFreeBranch` (колізія → `<branch>2`/`3`…), обовʼязковий опис і dirty-notice з переліком ≤10 файлів. `remove` лишається ефемерним (прибирає checkout + git-гілку). sanitizeBranch синхр. з Rust `sanitize_branch`. Бенчмарк JS vs Rust (Node-wrapper як entry) → логіка лишається в JS.

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
