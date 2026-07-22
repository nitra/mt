import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Гарантує зібраний mt-scanner перед тестами (scanner.mjs тепер шим над бінарником).
    globalSetup: './npm/lib/tests/global-setup.mjs',
    // Defense-in-depth: race у process.cwd() між паралельними test files (test.mdc)
    pool: 'forks'
  }
})
