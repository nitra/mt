import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Гарантує зібраний mt-scanner перед тестами (scanner.mjs тепер шим над бінарником).
    globalSetup: './npm/lib/tests/global-setup.mjs'
  }
})
