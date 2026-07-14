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
 * Канонізує тир моделі: uppercase ('MIN' | 'AVG' | 'MAX').
 * Порожнє/невизначене значення → ''.
 * @param {unknown} tier сире значення тиру
 * @returns {string} канонічний тир
 */
export function normalizeModelTier(tier) {
  return String(tier ?? '').toUpperCase()
}

/**
 * Конфігурація виконавців — **user-level, з ENV** (runtime.md «Підписочні
 * CLI-виконавці»): вона спільна для всіх репозиторіїв користувача і тому НЕ
 * живе у repo-scoped `.mt.json`.
 *
 * - `MT_AGENT_CLI` — дефолтний CLI (claude | codex | cursor | pi);
 * - `MT_CLOUD_AGENT_CLIS` — каскад хмарних CLI, comma-separated
 *   (напр. "codex,cursor");
 * - `MT_AGENT_CLI_MODEL_MAP` — JSON-мапа «CLI → тир → модель»
 *   (напр. {"codex":{"MIN":"gpt-5.6-luna","AVG":"gpt-5.6-terra","MAX":"gpt-5.6-sola"}}).
 * @param {Record<string, string | undefined>} env середовище процесу
 * @returns {{ agentCli: string, cloudAgentClis: string[], modelMap: Record<string, Record<string, string>> }} конфіг виконавців
 */
export function loadAgentCliEnv(env) {
  let modelMap = {}
  try {
    const parsed = JSON.parse(env.MT_AGENT_CLI_MODEL_MAP ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) modelMap = parsed
  } catch {
    modelMap = {}
  }
  return {
    agentCli: (env.MT_AGENT_CLI || 'claude').toLowerCase(),
    cloudAgentClis: (env.MT_CLOUD_AGENT_CLIS ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    modelMap
  }
}

/**
 * Резолвить конкретну модель тиру для підписочного CLI: MIN/AVG/MAX →
 * `modelMap[<cli>][<tier>]` з env `MT_AGENT_CLI_MODEL_MAP`. Немає мапінгу →
 * null: CLI резолвить модель сам, тир лишається hint-ом `MT_MODEL_TIER`.
 * @param {ReturnType<typeof loadAgentCliEnv>} cliEnv конфіг виконавців з ENV
 * @param {string} agentCli підписочний CLI ('claude' | 'codex' | 'cursor' | 'pi')
 * @param {string | undefined} modelTier 'MIN' | 'AVG' | 'MAX'
 * @returns {string | null} model id або null (CLI вирішує сам)
 */
export function resolveModelForCli(cliEnv, agentCli, modelTier) {
  return cliEnv.modelMap[agentCli]?.[normalizeModelTier(modelTier)] ?? null
}
