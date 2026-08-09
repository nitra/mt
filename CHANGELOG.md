# Changelog

## [0.30.6] - 2026-08-09

### Added

- docs(mandates): нормативний контракт M6 фаза 0 — схеми mandates.yaml, квіз-файлів, ApprovalResponse, napi-API

## [0.30.5] - 2026-08-09

### Added

- docs(architecture): principles.md — зведення 26 принципів канону і три шари обовʼязковості (normativity: principle/contract/reference) у фронтматері кожної глави

## [0.30.4] - 2026-08-09

### Changed

- docs(graph): a.md/h.md — YAML-фронтматер у markdown, не голий YAML (#65)

## [0.30.3] - 2026-08-09

### Added

- docs: фреймворк «Дельта» — ADR сесії та інтеграція в vision.md і mandates.md (директорська модель відповідальності, квіз-гейти, ШІ-мандати)

## [0.30.2] - 2026-08-09

### Changed

- docs(adr): brainstorm session delta-ai-human-orchestration (#63)

## [0.30.1] - 2026-07-23

### Removed

- Дочистка інфраструктури: прибрано мертві правила worktree/image-compress, застарілі дзеркала .agents/skills, чужі рантайм-логи .codex/hooks

## [0.30.0] - 2026-07-22

### Changed

- Максимально чистий spec-репо: прибрано layers/ (переїхав у nitra/mt-rust), тести, JS-лінт-тулінг і відповідні cursor-правила/скіли; залишились лише docs/ і md-лінт-тулінг. Виправлено md-борг (cspell/markdownlint) на docs/architecture, docs/overview, docs/roadmap.en.md.

## [0.29.0] - 2026-07-22

### Changed

- Прибрано workspaces із кореня — розблоковано n-cursor release для @7n/mt (раніше монорепо-детекція завжди пропускала корінь). layers/ став вкладеним пакетом зі своїм bun.lock; доданий pretest-скрипт (bun install --cwd layers) встановлює його залежності перед vitest.

Історія версій `@7n/mt` **≤ 0.28.0** (CLI-утиліта) — у [nitra/mt-js/CHANGELOG.md](https://github.com/nitra/mt-js/blob/main/CHANGELOG.md). Версії від **0.29.0** — це специфікація (вміст `docs/` цього репозиторію).
