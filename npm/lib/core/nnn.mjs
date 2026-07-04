/**
 * NNN-нумерація для артефактів задач (run_NNN.md, fact_NNN.md, тощо).
 *
 * Тонка обгортка над Rust-ядром (crates/mt-core/src/nnn.rs через napi-аддон):
 * список файлів досі надходить через ін'єкцію readdirSync (тестованість без FS),
 * а вся NNN-логіка виконується в Rust.
 * NNN = рядок з ведучими нулями до 3 цифр: '001', '002', …
 */
import { loadNative } from './native.mjs'

/**
 * Форматує число як NNN рядок (три цифри з ведучими нулями).
 * @param {number} n невід'ємне ціле число
 * @returns {string} '001', '002', …
 */
export function padNNN(n) {
  return loadNative().padNnn(n)
}

/**
 * Наступний NNN для run_NNN.md: count(run_*.md) + 1.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string} наступний NNN рядок
 */
export function nextRunNNN(taskDir, readdirSync) {
  return loadNative().nextRunNnn(readdirSync(taskDir))
}

/**
 * Наступний NNN для plan_NNN.md: max(plan_*.md numbers) + 1.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string} наступний NNN рядок
 */
export function nextPlanNNN(taskDir, readdirSync) {
  return loadNative().nextPlanNnn(readdirSync(taskDir))
}

/**
 * Найвищий NNN серед fact_NNN.md, або null якщо немає.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestFactNNN(taskDir, readdirSync) {
  return loadNative().latestFactNnn(readdirSync(taskDir))
}

/**
 * Знаходить NNN для останнього pending-audit_NNN.md (для audit-result).
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestPendingAuditNNN(taskDir, readdirSync) {
  return loadNative().latestPendingAuditNnn(readdirSync(taskDir))
}

/**
 * Знаходить NNN для останнього audit-result_NNN.md.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestAuditResultNNN(taskDir, readdirSync) {
  return loadNative().latestAuditResultNnn(readdirSync(taskDir))
}
