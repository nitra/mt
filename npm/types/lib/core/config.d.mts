/**
 * Завантажує конфігурацію з `.mt.json` і мержить із дефолтами.
 * @param {{
 *   root?: string,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean
 * }} [deps] ін'єкції
 * @returns {typeof CONFIG_DEFAULTS} злита конфігурація
 */
export function loadConfig(deps?: {
  root?: string
  readFile?: (p: string, enc: string) => string
  exists?: (p: string) => boolean
}): typeof CONFIG_DEFAULTS
/**
 * Повертає абсолютний шлях до mt_dir.
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string} root корінь репо
 * @returns {string} абсолютний шлях
 */
export function resolveMtDir(config: typeof CONFIG_DEFAULTS, root: string): string
/**
 * Повертає абсолютний шлях до worktrees_dir.
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string} root корінь репо
 * @returns {string} абсолютний шлях
 */
export function resolveWorktreesDir(config: typeof CONFIG_DEFAULTS, root: string): string
/**
 * Резолвить модель за model_tier із model_map або повертає claude_model (дефолт).
 * @param {typeof CONFIG_DEFAULTS} config конфігурація
 * @param {string | undefined} modelTier 'MIM' | 'AVG' | 'MAX'
 * @returns {string} model id
 */
export function resolveModelByTier(config: typeof CONFIG_DEFAULTS, modelTier: string | undefined): string
/** Дефолтні значення конфігурації (джерело істини — mt-core `config_defaults`). */
export const CONFIG_DEFAULTS: any
