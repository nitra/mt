/**
 * `mt run [<path>] [--actor a] [--auto]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string,
 *   spawnSync?: (cmd: string, args: string[], opts?: object) => object,
 *   statSync?: (p: string) => object,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function run(
  args: string[],
  deps?: {
    cwd?: string
    log?: (m: string) => void
    readFile?: (p: string, enc: string) => string
    writeFile?: (p: string, c: string, enc: string) => void
    readdir?: (d: string) => string[]
    exists?: (p: string) => boolean
    execSync?: (cmd: string, opts?: object) => string
    spawnSync?: (cmd: string, args: string[], opts?: object) => object
    statSync?: (p: string) => object
    now?: () => string
  }
): Promise<number>
