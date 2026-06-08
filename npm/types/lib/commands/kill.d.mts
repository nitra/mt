/**
 * `mt kill <path>` command handler.
 * @param {string[]} args аргументи: [path]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   unlink?: (p: string) => void,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function kill(args: string[], deps?: {
    cwd?: string;
    log?: (m: string) => void;
    readFile?: (p: string, enc: string) => string;
    writeFile?: (p: string, c: string, enc: string) => void;
    readdir?: (d: string) => string[];
    exists?: (p: string) => boolean;
    unlink?: (p: string) => void;
    execSync?: (cmd: string, opts?: object) => string;
}): Promise<number>;
