/**
 * Будує шаблон plan_NNN.md.
 * @param {{ mode: string, hint: string, now: string, nnn: string }} params параметри
 * @returns {string} вміст файлу
 */
export function buildPlanTemplate(params: { mode: string; hint: string; now: string; nnn: string }): string
/**
 * `mt plan [<path>] [--mode agent]` command handler.
 * @param {string[]} args аргументи: [path] [--mode agent|human]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function plan(
  args: string[],
  deps?: {
    cwd?: string
    log?: (m: string) => void
    writeFile?: (p: string, c: string, enc: string) => void
    readFile?: (p: string, enc: string) => string
    readdir?: (d: string) => string[]
    exists?: (p: string) => boolean
    now?: () => string
  }
): Promise<number>
