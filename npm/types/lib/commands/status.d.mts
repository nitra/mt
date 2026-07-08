/**
 * `mt status [<path>] [--json]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function status(
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
