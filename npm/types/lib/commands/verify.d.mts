/**
 * `mt verify` handler.
 * @param {string[]} _rest аргументи після `verify` (не використовуються)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (path: string, enc: string) => string,
 *   readdir?: (dir: string) => string[],
 *   exists?: (path: string) => boolean
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0=OK, 1=структурна помилка)
 */
export default function verify(
  _rest: string[],
  deps?: {
    cwd?: string
    log?: (m: string) => void
    readFile?: (path: string, enc: string) => string
    readdir?: (dir: string) => string[]
    exists?: (path: string) => boolean
  }
): Promise<number>
