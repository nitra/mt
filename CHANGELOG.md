# Changelog

## [0.29.0] - 2026-07-22

### Changed

- Прибрано workspaces із кореня — розблоковано n-cursor release для @7n/mt (раніше монорепо-детекція завжди пропускала корінь). layers/ став вкладеним пакетом зі своїм bun.lock; доданий pretest-скрипт (bun install --cwd layers) встановлює його залежності перед vitest.

Історія версій `@7n/mt` **≤ 0.28.0** (CLI-утиліта) — у [nitra/mt-js/CHANGELOG.md](https://github.com/nitra/mt-js/blob/main/CHANGELOG.md). Версії від **0.29.0** — це специфікація (вміст `docs/` цього репозиторію).
