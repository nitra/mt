/**
 * Будує front-matter для task.md шаблону.
 * @param {{ now: string, name: string }} params параметри
 * @returns {Record<string, unknown>} front-matter об'єкт
 */
export function buildTaskFrontMatter(params: {
    now: string;
    name: string;
}): Record<string, unknown>;
/**
 * `mt init <name>` command handler.
 * @param {string[]} args аргументи: [name]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   exists?: (p: string) => boolean,
 *   mkdir?: (p: string, opts?: object) => void,
 *   now?: () => string,
 *   readFile?: (p: string, enc: string) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function init(args: string[], deps?: {
    cwd?: string;
    log?: (m: string) => void;
    writeFile?: (p: string, c: string, enc: string) => void;
    exists?: (p: string) => boolean;
    mkdir?: (p: string, opts?: object) => void;
    now?: () => string;
    readFile?: (p: string, enc: string) => string;
}): Promise<number>;
