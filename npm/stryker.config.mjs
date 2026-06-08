import '@stryker-mutator/vitest-runner'

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.js' },
  // perTest: Stryker запускає лише тести, що покривають мутовану лінію — головний приріст швидкості.
  coverageAnalysis: 'perTest',
  // vitest-runner ізолює мутантів у пам'яті через AST-patching, без копіювання node_modules у sandbox.
  tempDirName: 'reports/stryker/.tmp',
  reporters: ['json', 'clear-text'],
  jsonReporter: { fileName: 'reports/stryker/mutation.json' },
  // incremental: зберігає результати між запусками, відновлює після краш/kill.
  incremental: true,
  incrementalFile: 'reports/stryker/incremental.json',
  // Покриваємо production-код. Test-файли Stryker виключає за іменем (`*.test.*`) автоматично.
  mutate: ['index.js', 'bin/**/*.js', '!**/*.test.{js,mjs}', '!**/tests/**']
}
