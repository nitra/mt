/**
 * Завантаження конфігурації `.mt.json` для mt-команд.
 *
 * Дефолти та merge-логіка (включно з deep merge `model_map`) живуть у Rust-ядрі
 * (crates/mt-core/src/config.rs через napi-аддон). Читання файлів лишається тут —
 * FS ін'єктується для тестованості без диска.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadNative } from './native.mjs'

/** Дефолтні значення конфігурації (джерело істини — mt-core `config_defaults`). */
export const CONFIG_DEFAULTS = loadNative().configDefaults()

/**
 * Завантажує конфігурацію з `.mt.json` і мержить із дефолтами.
 * @param {{
 *   root?: string,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean
 * }} [deps] ін'єкції
 * @returns {typeof CONFIG_DEFAULTS} злита конфігурація
 */
export function loadConfig(deps = {}) {
  const root = deps.root ?? processCwd()
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const exists = deps.exists ?? existsSync

  const configPath = join(root, '.mt.json')
  const raw = exists(configPath) ? readFile(configPath, 'utf8') : null

  return loadNative().mergeConfig(raw)
}

/**
 * Повертає абсолютний шлях до mt_dir.
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string} root корінь репо
 * @returns {string} абсолютний шлях
 */
export function resolveMtDir(config, root) {
  const d = config.mt_dir
  return d.startsWith('/') ? d : join(root, d)
}

/**
 * Повертає абсолютний шлях до worktrees_dir.
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string} root корінь репо
 * @returns {string} абсолютний шлях
 */
export function resolveWorktreesDir(config, root) {
  const d = config.worktrees_dir
  return d.startsWith('/') ? d : join(root, d)
}

/**
 * Резолвить модель за model_tier із model_map або повертає claude_model (дефолт).
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string | undefined} modelTier 'MIM' | 'AVG' | 'MAX'
 * @returns {string} model id
 */
export function resolveModelByTier(config, modelTier) {
  if (modelTier && config.model_map[modelTier]) {
    return config.model_map[modelTier]
  }
  return config.claude_model
}
