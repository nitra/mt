import { getConfig } from '@nitra/eslint-config'
import globals from 'globals'

// getConfig({ node: ['npm'] }) у @nitra/eslint-config задає Node globals лише для glob `npm/**/*.js`
// (не .mjs/.cjs). Для npm/**/*.mjs додаємо globals.node окремо, інакше no-undef на process і console.
export default [
  {
    ignores: [
      '**/auto-imports.d.ts',
      'docs/**',
      '.claude/worktrees/**',
      // Згенеровані артефакти (gitignored): coverage report і Stryker mutation sandbox/output.
      '**/coverage/**',
      '**/reports/stryker/**'
    ]
  },
  ...getConfig({
    node: ['npm']
  }),
  {
    files: ['npm/**/*.{mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  // npm-module rule забороняє devDependencies у npm/package.json (compact published tarball),
  // тож vitest/stryker stack живе у кореневому package.json і резолвиться через bun hoisted
  // node_modules. `n/no-extraneous-import` цього не бачить — allowModules ставить exception.
  {
    files: ['npm/**/*.{js,mjs,cjs}'],
    rules: {
      'n/no-extraneous-import': [
        'error',
        { allowModules: ['vitest', '@vitest/coverage-v8', '@stryker-mutator/vitest-runner'] }
      ]
    }
  },
  // Grandfather: три legacy-команди перевищували поріг cognitive-complexity ще ДО появи
  // гейта `n-rules lint js` у CI (canon-snippet lint-js.yml, mixin @7n/rules-lang-js).
  // Рефакторинг — окрема задача; для нового коду правило діє скрізь.
  {
    files: ['npm/lib/commands/scan.mjs', 'npm/lib/commands/setup.mjs', 'npm/lib/commands/watch.mjs'],
    rules: {
      'sonarjs/cognitive-complexity': 'off'
    }
  },
  // Тест-хелпери не потребують JSDoc. `jsdoc/require-jsdoc` (warning) автофіксом вставляє
  // порожні `/** */` заглушки, які oxlint (`jsdoc/require-param`/`require-returns`, deny)
  // потім відхиляє → `bun run lint` неідемпотентний (oxlint --fix && eslint --fix). Вимикаємо
  // presence-вимогу для тестів; повноту наявних JSDoc усе одно стереже oxlint.
  {
    files: ['**/*.test.{js,mjs,cjs}', '**/tests/**/*.{js,mjs,cjs}'],
    rules: {
      'jsdoc/require-jsdoc': 'off'
    }
  }
]
