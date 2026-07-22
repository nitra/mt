import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
// Канонічна документація — весь корпус docs/ (глави architecture/ та індекси);
// окремого frozen-контракту немає з M1 (mt.md видалено). ADR-корпус переїхав у
// mt-rust разом із реалізацією — тут лишається лише специфікація.
const docsDir = join(repositoryRoot, 'docs')
const legacyRuntime =
  /n-cursor (?:flow|graph)|\.flow\.json|docs\/думка\.MD|npm\/docs\/flow\.MD|Пасивн(?:ий|ого) Турнікет|Активн(?:ий|ого) Раннер/i
const unsupportedSurface = /graph audit|n-cursor watch|NCURSOR_|mt migrate|mt audit-retry/i
const removedContractLink = /\]\((?:\.\.\/)?mt\.md\)/

/**
 * Рекурсивно збирає md-файли директорії.
 * @param {string} dir абсолютний шлях директорії
 * @returns {string[]} абсолютні шляхи md-файлів
 */
function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(entry.parentPath, entry.name))
}

describe('MT documentation', () => {
  test('canonical documentation uses only the supported MT surface', () => {
    const files = markdownFiles(docsDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const contents = readFileSync(file, 'utf8')
      expect(contents, file).not.toMatch(legacyRuntime)
      expect(contents, file).not.toMatch(unsupportedSurface)
    }
  })

  test('canonical documentation has no links to removed mt.md', () => {
    for (const file of markdownFiles(docsDir)) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(removedContractLink)
    }
  })
})
