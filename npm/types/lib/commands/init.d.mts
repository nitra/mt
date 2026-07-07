/**
 * Розбирає argv `mt init`: перший non-flag токен — ім'я, решта — прапорці
 * (прокидаються в бінарник вербатим; авторитетний парсинг — у Rust).
 * @param {string[]} args аргументи після `init`
 * @returns {{ name: string | null, flags: string[], error?: string }} розібране ім'я,
 *   список прапорців для бінарника та опційний текст помилки парсингу
 */
export function parseInitArgs(args: string[]): {
  name: string | null
  flags: string[]
  error?: string
}
/**
 * `mt init <name> [flags]` command handler.
 * @param {string[]} args аргументи: [name, ...flags]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   spawnSync?: typeof spawnSync,
 *   binPath?: string,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean
 * }} [deps] ін'єкції
 * @returns {number} exit code (0 створено/існує, 1 usage/помилка)
 */
export default function init(
  args: string[],
  deps?: {
    cwd?: string
    log?: (m: string) => void
    spawnSync?: typeof spawnSync
    binPath?: string
    readFile?: (p: string, enc: string) => string
    exists?: (p: string) => boolean
  }
): number
