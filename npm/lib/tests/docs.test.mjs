import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const canonicalSpec = join(repositoryRoot, 'npm/docs/mt.md')
const adrDir = join(repositoryRoot, 'docs/adr')
const legacyRuntime =
  /n-cursor (?:flow|graph)|\.flow\.json|docs\/думка\.MD|npm\/docs\/flow\.MD|Пасивн(?:ий|ого) Турнікет|Активн(?:ий|ого) Раннер/i
const unsupportedSurface = /graph audit|n-cursor watch|NCURSOR_|mt migrate|mt audit-retry/i

describe('MT documentation', () => {
  test('canonical specification uses only the supported MT surface', () => {
    const contents = readFileSync(canonicalSpec, 'utf8')

    expect(contents).not.toMatch(legacyRuntime)
    expect(contents).not.toMatch(unsupportedSurface)
  })

  test('contains exactly the 168 transferred ADRs without legacy runtime names', () => {
    const adrFiles = readdirSync(adrDir).filter(file => file.endsWith('.md'))

    expect(adrFiles).toHaveLength(168)
    for (const file of adrFiles) {
      expect(readFileSync(join(adrDir, file), 'utf8'), file).not.toMatch(legacyRuntime)
    }
  })
})
