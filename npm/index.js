import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HELP = `@7n/mt — CLI

Використання:
  npx @7n/mt <команда> [аргументи]

Команди:
  version         Показати версію
  help            Показати цю довідку

Опції:
  -h, --help      Показати довідку
  -v, --version   Показати версію
`

/**
 * Повертає version пакета з його package.json.
 * @returns {string} версія пакета
 */
export function version() {
  const pkgPath = fileURLToPath(new URL('package.json', import.meta.url))
  return JSON.parse(readFileSync(pkgPath, 'utf8')).version
}
