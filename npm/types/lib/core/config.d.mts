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
 * Канонізує тир моделі: uppercase ('MIN' | 'AVG' | 'MAX').
 * Порожнє/невизначене значення → ''.
 * @param {unknown} tier сире значення тиру
 * @returns {string} канонічний тир
 */
export function normalizeModelTier(tier: unknown): string
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
export function loadAgentCliEnv(env: Record<string, string | undefined>): {
  agentCli: string
  cloudAgentClis: string[]
  modelMap: Record<string, Record<string, string>>
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
export function resolveModelForCli(
  cliEnv: ReturnType<typeof loadAgentCliEnv>,
  agentCli: string,
  modelTier: string | undefined
): string | null
/** Дефолтні значення конфігурації (джерело істини — mt-core `config_defaults`). */
export const CONFIG_DEFAULTS: any
