import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Тести поряд із кодом (`layers/lib/tests/**`) і top-level integration suites у `tests/`.
    include: ['**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/reports/stryker/**'],
    environment: 'node',
    // Ізоляція процесів між test-файлами як safety net на випадковий `process.chdir`.
    pool: 'forks',
    coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
  }
})
