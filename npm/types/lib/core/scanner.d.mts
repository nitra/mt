/**
 * @typedef {{
 *   id: string,
 *   path: string,
 *   dir: string,
 *   deps: string[],
 *   state: string,
 *   composite: boolean,
 *   children: string[]
 * }} TaskInfo
 */
/**
 * Рекурсивно знаходить всі задачі DAG у mt_dir.
 * Задача = директорія що містить task.md.
 * @param {string} mtDir абсолютний шлях до mt/
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   existsSync?: (p: string) => boolean,
 *   readFileSync?: (p: string, enc: string) => string
 * }} [deps] ін'єкції
 * @returns {{ dir: string, relPath: string }[]} список знайдених задач
 */
export function findTasks(mtDir: string, deps?: {
    readdirSync?: (d: string) => string[];
    existsSync?: (p: string) => boolean;
    readFileSync?: (p: string, enc: string) => string;
}): {
    dir: string;
    relPath: string;
}[];
/**
 * Сканує DAG і повертає всі задачі з деривованими станами.
 * @param {string} mtDir абсолютний шлях до mt/
 * @param {Set<string>} activeWorktrees активні worktree імена
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   existsSync?: (p: string) => boolean,
 *   readFileSync?: (p: string, enc: string) => string
 * }} [deps] ін'єкції
 * @returns {TaskInfo[]} список задач
 */
export function scanTasks(mtDir: string, activeWorktrees: Set<string>, deps?: {
    readdirSync?: (d: string) => string[];
    existsSync?: (p: string) => boolean;
    readFileSync?: (p: string, enc: string) => string;
}): TaskInfo[];
/**
 * Топологічне сортування задач (алгоритм Кана).
 * Задачі без залежностей — першими. Циклічні залежності — не гарантовано.
 * @param {TaskInfo[]} tasks задачі зі списком deps
 * @returns {TaskInfo[]} відсортований список (або той самий порядок якщо циклічні)
 */
export function topoSort(tasks: TaskInfo[]): TaskInfo[];
/**
 * Перевіряє чи всі залежності задачі resolved.
 * @param {TaskInfo} task задача
 * @param {Map<string, TaskInfo>} taskMap map id -> TaskInfo
 * @returns {boolean} true якщо всі deps resolved
 */
export function areDepsResolved(task: TaskInfo, taskMap: Map<string, TaskInfo>): boolean;
/**
 * Знаходить активні worktrees з git worktree list.
 * @param {string} root корінь репо
 * @param {{ execSync?: (cmd: string, opts?: object) => string }} [deps] ін'єкції
 * @returns {Set<string>} set імен worktree
 */
export function getActiveWorktrees(root: string, deps?: {
    execSync?: (cmd: string, opts?: object) => string;
}): Set<string>;
/**
 * Парсить вивід `git worktree list --porcelain` і повертає набір імен worktree.
 * @param {string} output вивід команди
 * @returns {Set<string>} set імен (останній компонент шляху)
 */
export function parseWorktreeList(output: string): Set<string>;
export type TaskInfo = {
    id: string;
    path: string;
    dir: string;
    deps: string[];
    state: string;
    composite: boolean;
    children: string[];
};
