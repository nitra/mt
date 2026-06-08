import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Тести поряд із кодом (`*.test.{js,mjs}`) і top-level integration suites у `tests/`.
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    // reports/stryker/.tmp/ містить sandbox-копії тестів від Stryker — без exclude
    // `vitest run --coverage` їх підхоплює і вони фейляться поза реальним repo root.
    exclude: ['**/node_modules/**', '**/dist/**', '**/reports/stryker/**'],
    environment: 'node',
    // Ізоляція процесів між test-файлами як safety net на випадковий `process.chdir`.
    pool: 'forks',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
