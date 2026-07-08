/**
 * Пише run_NNN.md артефакт.
 * @param {string} taskDir директорія задачі
 * @param {string} nnn NNN рядок
 * @param {'success'|'failed'} result результат
 * @param {{ actor: string, now: string }} meta метадані
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
export function writeRunFile(taskDir: string, nnn: string, result: "success" | "failed", meta: {
    actor: string;
    now: string;
}, writeFile: (p: string, c: string, enc: string) => void): void;
/**
 * Резолвить шлях задачі з аргументів або env (`MT_TASK_PATH`).
 * @param {string[]} args аргументи командного рядка
 * @param {{ env?: Record<string, string> }} [deps] ін'єкції
 * @returns {{ taskPath: string | null, error: string | null }} результат
 */
export function resolveTaskPath(args: string[], deps?: {
    env?: Record<string, string>;
}): {
    taskPath: string | null;
    error: string | null;
};
