/**
 * Генерує ім'я worktree для задачі.
 * @param {string} taskPath відносний шлях задачі (напр. "research/collect-data")
 * @param {number} [epochSec] epoch в секундах (default: Date.now()/1000)
 * @returns {string} ім'я worktree
 */
export function makeWorktreeName(taskPath: string, epochSec?: number): string
/**
 * Створює git worktree для задачі з atomic mkdir lock.
 * Повертає null якщо worktree вже існує (EEXIST → вже запущено).
 * @param {string} worktreesDir абсолютний шлях до .worktrees/
 * @param {string} worktreeName ім'я нового worktree
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string,
 *   mkdirSync?: (p: string, opts?: object) => void
 * }} [deps] ін'єкції
 * @returns {{ worktreePath: string, branch: string } | null} worktree або null якщо вже існує
 */
export function createWorktree(
  worktreesDir: string,
  worktreeName: string,
  root: string,
  deps?: {
    execSync?: (cmd: string, opts?: object) => string
    mkdirSync?: (p: string, opts?: object) => void
  }
): {
  worktreePath: string
  branch: string
} | null
/**
 * Видаляє git worktree.
 * @param {string} worktreePath абсолютний шлях до worktree
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 */
export function removeWorktree(
  worktreePath: string,
  root: string,
  deps?: {
    execSync?: (cmd: string, opts?: object) => string
  }
): void
/**
 * Мерджить зміни з worktree у main-гілку і видаляє worktree.
 * @param {string} worktreePath абсолютний шлях до worktree
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {{ ok: boolean, error?: string }} результат
 */
export function mergeWorktree(
  worktreePath: string,
  root: string,
  deps?: {
    execSync?: (cmd: string, opts?: object) => string
  }
): {
  ok: boolean
  error?: string
}
/**
 * Повертає список активних worktrees з репо.
 * @param {string} root корінь репо
 * @param {{
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Set<string>} set імен worktrees
 */
export function listActiveWorktrees(
  root: string,
  deps?: {
    execSync?: (cmd: string, opts?: object) => string
  }
): Set<string>
/**
 * Знаходить worktree що належить задачі (за prefix).
 * @param {string} taskPath відносний шлях задачі
 * @param {string} worktreesDir абсолютний шлях до .worktrees/
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {string | null} абсолютний шлях до worktree або null
 */
export function findTaskWorktree(
  taskPath: string,
  worktreesDir: string,
  deps?: {
    readdirSync?: (d: string) => string[]
    execSync?: (cmd: string, opts?: object) => string
  }
): string | null
