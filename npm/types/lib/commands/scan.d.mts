/**
 * `mt scan [--json]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0=clean, 1=attention)
 */
export default function scan(
  args: string[],
  deps?: {
    cwd?: string
    log?: (m: string) => void
    readFile?: (p: string, enc: string) => string
    readdir?: (d: string) => string[]
    exists?: (p: string) => boolean
    execSync?: (cmd: string, opts?: object) => string
  }
): Promise<number>
