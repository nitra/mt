/**
 * Перевіряє чи директорія є composite-задачею (містить дочірні директорії з task.md).
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {{ readdirSync?: (d: string) => string[], existsSync?: (p: string) => boolean }} [deps] ін'єкції
 * @returns {boolean} true якщо є хоча б один дочірній вузол
 */
export function isComposite(taskDir: string, deps?: {
    readdirSync?: (d: string) => string[];
    existsSync?: (p: string) => boolean;
}): boolean;
/**
 * Деривує composite-стан з масиву станів дочірніх задач.
 * @param {string[]} childStates масив станів дочірніх задач
 * @returns {string} агрегований стан
 */
export function deriveCompositeState(childStates: string[]): string;
/**
 * Деривує стан однієї задачі з присутності файлів.
 *
 * Пріоритет: invalidated > pending-audit > resolved > running > failed > waiting > needs-plan
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {Set<string>} activeWorktrees set імен активних worktree (наприклад, 'my-task-1234567890')
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   readFileSync?: (p: string, enc: string) => string,
 *   existsSync?: (p: string) => boolean
 * }} [deps] ін'єкції
 * @returns {string} стан задачі
 */
export function deriveNodeState(taskDir: string, activeWorktrees: Set<string>, deps?: {
    readdirSync?: (d: string) => string[];
    readFileSync?: (p: string, enc: string) => string;
    existsSync?: (p: string) => boolean;
}): string;
/**
 * Санітизує ім'я задачі для використання в назві worktree.
 * @param {string} name ім'я задачі (може містити /)
 * @returns {string} санітизоване ім'я
 */
export function sanitizeTaskName(name: string): string;
/** Всі можливі стани задачі. */
export const NODE_STATES: readonly ["needs-plan", "waiting", "running", "pending-audit", "resolved", "failed", "invalidated"];
