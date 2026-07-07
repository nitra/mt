/**
 * `mt invalidate <path> [--no-cascade]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function invalidate(
  args: string[],
  deps?: {
    cwd?: string
    log?: (m: string) => void
    readFile?: (p: string, enc: string) => string
    writeFile?: (p: string, c: string, enc: string) => void
    readdir?: (d: string) => string[]
    exists?: (p: string) => boolean
    execSync?: (cmd: string, opts?: object) => string
  }
): Promise<number>
