import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const repositoryRoot = join(packageRoot, '..')
const INTERNAL_DECLARATION_IMPORT_RE = /from\s+['"]\.\/lib\/cli\.mjs/

describe('package contract', () => {
  test('points npm metadata at the MT repository', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

    expect(pkg.homepage).toBe('https://github.com/nitra/mt#readme')
    expect(pkg.bugs.url).toBe('https://github.com/nitra/mt/issues')
    expect(pkg.repository.url).toBe('git+https://github.com/nitra/mt.git')
  })

  test('does not publish test files', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

    expect(pkg.files).toContain('!**/*.test.mjs')
  })

  test('root start script launches the mt binary', () => {
    const pkg = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))

    expect(pkg.scripts.start).toBe('bun ./npm/bin/mt.js')
  })

  test('ships TypeScript declarations for re-exported modules', () => {
    const declarations = readFileSync(join(packageRoot, 'types/index.d.ts'), 'utf8')

    expect(declarations).toMatch(INTERNAL_DECLARATION_IMPORT_RE)
    expect(readFileSync(join(packageRoot, 'types/lib/cli.d.mts'), 'utf8')).toContain('runMtCli')
  })
})
