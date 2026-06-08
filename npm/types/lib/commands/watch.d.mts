/**
 * `mt watch` command handler (one-shot scan).
 * @param {string[]} args аргументи (зазвичай порожні)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string,
 *   statSync?: (p: string) => { mtimeMs: number },
 *   now?: () => number
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0=clean, 1=attention)
 */
export default function watch(args: string[], deps?: {
    cwd?: string;
    log?: (m: string) => void;
    readFile?: (p: string, enc: string) => string;
    readdir?: (d: string) => string[];
    exists?: (p: string) => boolean;
    execSync?: (cmd: string, opts?: object) => string;
    statSync?: (p: string) => {
        mtimeMs: number;
    };
    now?: () => number;
}): Promise<number>;
