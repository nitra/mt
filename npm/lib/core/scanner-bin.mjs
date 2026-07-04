/**
 * Резолвер шляху до `mt-scanner` (Rust-бінарник).
 *
 * Порядок пошуку:
 *   1. MT_SCANNER_BIN — явний override (dev / CI / тести).
 *   2. Platform-підпакет `@7n/mt-<platform>-<arch>` (esbuild-модель, optionalDependencies).
 *   3. Dev-fallback: <repoRoot>/target/release|debug/mt-scanner.
 *   4. Інакше — зрозуміла помилка з підказкою.
 *
 * Результат кешується (один пошук на процес).
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform as osPlatform, arch as osArch, env as procEnv } from 'node:process'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
/** Корінь репо: npm/lib/core → up 3. */
const REPO_ROOT = join(HERE, '..', '..', '..')

/** @type {string | null} */
let cached = null

/**
 * Ім'я виконуваного файлу для платформи (на Windows — з .exe).
 * @param {string} platform process.platform
 * @returns {string} ім'я виконуваного файлу
 */
function binName(platform) {
  return platform === 'win32' ? 'mt-scanner.exe' : 'mt-scanner'
}

/**
 * Резолвить абсолютний шлях до бінарника `mt-scanner`.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: string,
 *   arch?: string,
 *   existsSync?: (p: string) => boolean,
 *   requireResolve?: (id: string) => string,
 *   repoRoot?: string
 * }} [deps] ін'єкції для тестів
 * @returns {string} шлях до виконуваного бінарника
 */
export function resolveScannerBin(deps = {}) {
  const env = deps.env ?? procEnv
  const platform = deps.platform ?? osPlatform
  const arch = deps.arch ?? osArch
  const exists = deps.existsSync ?? existsSync
  const requireResolve = deps.requireResolve ?? (id => require.resolve(id))
  const repoRoot = deps.repoRoot ?? REPO_ROOT

  const bin = binName(platform)

  // 1. Явний override.
  const override = env.MT_SCANNER_BIN
  if (override) return override

  const key = `${platform}-${arch}`

  // 2. Platform-підпакет.
  try {
    return requireResolve(`@7n/mt-${key}/${bin}`)
  } catch {
    // не встановлено — пробуємо dev-fallback
  }

  // 3. Dev-fallback: зібраний локально бінарник.
  for (const profile of ['release', 'debug']) {
    const candidate = join(repoRoot, 'target', profile, bin)
    if (exists(candidate)) return candidate
  }

  // 4. Помилка з підказкою.
  throw new Error(
    `mt-scanner: немає prebuilt-бінарника для "${key}". ` +
      `Постав MT_SCANNER_BIN=/шлях/до/${bin}, додай підпакет @7n/mt-${key}, ` +
      `або збери локально: cargo build --release -p mt-cli`
  )
}

/**
 * Кешований резолвер (один пошук на процес). Override через resolveScannerBin для тестів.
 * @returns {string} шлях до бінарника
 */
export function scannerBin() {
  if (cached === null) cached = resolveScannerBin()
  return cached
}
