/**
 * Loader napi-аддона `mt` (Rust-ядро `crates/mt-napi` → `mt-core`).
 *
 * Порядок пошуку:
 *   1. MT_NATIVE_ADDON — явний override шляху до аддона (dev / CI / тести).
 *   2. Platform-підпакет `@7n/mt-<platform>-<arch>` (napi-артефакт `mt.<triple>.node`).
 *   3. Dev-fallback: <repoRoot>/target/release|debug/libmt_napi.dylib|.so
 *      та вивід `napi build` у crates/mt-napi/.
 *   4. Інакше — зрозуміла помилка з підказкою.
 *
 * Аддон завантажується через `process.dlopen` — працює і для `.node`, і для
 * сирих cdylib (`.dylib`/`.so`) із `cargo build` без napi CLI.
 * Результат кешується (одне завантаження на процес).
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process, { arch as osArch, env as procEnv, platform as osPlatform } from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
/** Корінь репо: npm/lib/core → up 3. */
const REPO_ROOT = join(HERE, '..', '..', '..')

/** Підтримувані platform-arch → napi-суфікс артефакта. */
const NAPI_SUFFIXES = {
  'darwin-arm64': 'darwin-arm64',
  'linux-x64': 'linux-x64-gnu'
}

/** @type {Record<string, unknown> | null} */
let cached = null

/**
 * Завантажує аддон за шляхом через process.dlopen.
 * @param {string} p шлях до .node / .dylib / .so
 * @returns {Record<string, unknown>} exports аддона
 */
function dlopenAddon(p) {
  const mod = { exports: {} }
  process.dlopen(mod, p)
  return mod.exports
}

/**
 * Ім'я cdylib-файлу для платформи (вивід `cargo build -p mt-napi`).
 * @param {string} platform process.platform
 * @returns {string} ім'я бібліотеки
 */
function cdylibName(platform) {
  return platform === 'darwin' ? 'libmt_napi.dylib' : 'libmt_napi.so'
}

/**
 * Резолвить шлях до napi-аддона `mt`.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: string,
 *   arch?: string,
 *   existsSync?: (p: string) => boolean,
 *   requireResolve?: (id: string) => string,
 *   repoRoot?: string
 * }} [deps] ін'єкції для тестів
 * @returns {string} шлях до файлу аддона
 */
export function resolveNativeAddon(deps = {}) {
  const env = deps.env ?? procEnv
  const platform = deps.platform ?? osPlatform
  const arch = deps.arch ?? osArch
  const exists = deps.existsSync ?? existsSync
  const requireResolve = deps.requireResolve ?? (id => require.resolve(id))
  const repoRoot = deps.repoRoot ?? REPO_ROOT

  // 1. Явний override.
  const override = env.MT_NATIVE_ADDON
  if (override) return override

  const key = `${platform}-${arch}`
  const suffix = NAPI_SUFFIXES[key]

  // 2. Platform-підпакет (napi-артефакт поряд із mt-scanner бінарником).
  if (suffix) {
    try {
      return requireResolve(`@7n/mt-${key}/mt.${suffix}.node`)
    } catch {
      // не встановлено — пробуємо dev-fallback
    }
  }

  // 3. Dev-fallback: cargo-збірка (сирий cdylib) або вивід napi build.
  const candidates = []
  for (const profile of ['release', 'debug']) {
    candidates.push(join(repoRoot, 'target', profile, cdylibName(platform)))
  }
  if (suffix) {
    candidates.push(join(repoRoot, 'crates', 'mt-napi', `mt.${suffix}.node`))
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }

  // 4. Помилка з підказкою.
  throw new Error(
    `mt native addon: немає збірки для "${key}". ` +
      `Постав MT_NATIVE_ADDON=/шлях/до/аддона, додай підпакет @7n/mt-${key}, ` +
      `або збери локально: cargo build --release -p mt-napi`
  )
}

/**
 * Кешований доступ до аддона (одне завантаження на процес).
 * @param {{ resolve?: () => string, dlopen?: (p: string) => Record<string, unknown> }} [deps] ін'єкції
 * @returns {Record<string, unknown>} exports аддона (scanTasks, createTask, …)
 */
export function loadNative(deps = {}) {
  if (cached === null) {
    const path = (deps.resolve ?? resolveNativeAddon)()
    cached = (deps.dlopen ?? dlopenAddon)(path)
  }
  return cached
}
