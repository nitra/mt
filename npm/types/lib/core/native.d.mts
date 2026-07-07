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
export function resolveNativeAddon(deps?: {
  env?: Record<string, string | undefined>
  platform?: string
  arch?: string
  existsSync?: (p: string) => boolean
  requireResolve?: (id: string) => string
  repoRoot?: string
}): string
/**
 * Кешований доступ до аддона (одне завантаження на процес).
 * @param {{ resolve?: () => string, dlopen?: (p: string) => Record<string, unknown> }} [deps] ін'єкції
 * @returns {Record<string, unknown>} exports аддона (scanTasks, createTask, …)
 */
export function loadNative(deps?: {
  resolve?: () => string
  dlopen?: (p: string) => Record<string, unknown>
}): Record<string, unknown>
