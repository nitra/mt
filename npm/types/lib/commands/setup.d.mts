/**
 * `mt setup` command handler.
 * @param {string[]} _args аргументи (не використовуються)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean,
 *   mkdir?: (p: string, opts?: object) => void,
 *   chmod?: (p: string, mode: number) => void,
 *   resolveHooksDir?: (root: string) => string | null
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function setup(_args: string[], deps?: {
    cwd?: string;
    log?: (m: string) => void;
    writeFile?: (p: string, c: string, enc: string) => void;
    readFile?: (p: string, enc: string) => string;
    exists?: (p: string) => boolean;
    mkdir?: (p: string, opts?: object) => void;
    chmod?: (p: string, mode: number) => void;
    resolveHooksDir?: (root: string) => string | null;
}): Promise<number>;
