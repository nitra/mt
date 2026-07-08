/**
 * Форматує число як NNN рядок (три цифри з ведучими нулями).
 * @param {number} n невід'ємне ціле число
 * @returns {string} '001', '002', …
 */
export function padNNN(n: number): string;
/**
 * Наступний NNN для run_NNN.md: count(run_*.md) + 1.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string} наступний NNN рядок
 */
export function nextRunNNN(taskDir: string, readdirSync: (dir: string) => string[]): string;
/**
 * Наступний NNN для plan_NNN.md: max(plan_*.md numbers) + 1.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string} наступний NNN рядок
 */
export function nextPlanNNN(taskDir: string, readdirSync: (dir: string) => string[]): string;
/**
 * Найвищий NNN серед fact_NNN.md, або null якщо немає.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestFactNNN(taskDir: string, readdirSync: (dir: string) => string[]): string | null;
/**
 * Знаходить NNN для останнього pending-audit_NNN.md (для audit-result).
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestPendingAuditNNN(taskDir: string, readdirSync: (dir: string) => string[]): string | null;
/**
 * Знаходить NNN для останнього audit-result_NNN.md.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestAuditResultNNN(taskDir: string, readdirSync: (dir: string) => string[]): string | null;
