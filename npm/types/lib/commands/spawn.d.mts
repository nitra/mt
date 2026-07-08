/**
 * `mt spawn <path>` command handler.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function spawn(args: string[], deps?: object): Promise<number>
