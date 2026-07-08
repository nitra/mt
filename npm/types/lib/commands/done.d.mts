/**
 * `mt done <path>` command handler.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function done(args: string[], deps?: object): Promise<number>
