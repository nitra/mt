/**
 * Деривація стану задачі з файлової системи (immutable file-presence protocol).
 *
 * Стан визначається виключно наявністю файлів у mt/<task>/:
 *   invalidated > pending-audit > resolved > running > failed > waiting > needs-plan
 *
 * Чиста функція — FS ін'єктується. Не пише нічого на диск.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { hasPendingAudit, latestFactNNN } from './nnn.mjs'

/** Regex для run_NNN.md файлів. */
const RUN_FILE_RE = /^run_\d+\.md$/
/** Regex для plan_NNN.md файлів. */
const PLAN_FILE_RE = /^plan_\d+\.md$/

/** Всі можливі стани задачі. */
export const NODE_STATES = /** @type {const} */ ([
  'needs-plan',
  'waiting',
  'running',
  'pending-audit',
  'resolved',
  'failed',
  'invalidated'
])

/**
 * Перевіряє чи директорія є composite-задачею (містить дочірні директорії з task.md).
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {{ readdirSync?: (d: string) => string[], existsSync?: (p: string) => boolean }} [deps] ін'єкції
 * @returns {boolean} true якщо є хоча б один дочірній вузол
 */
export function isComposite(taskDir, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const exists = deps.existsSync ?? existsSync

  let entries
  try {
    entries = readdir(taskDir)
  } catch {
    return false
  }

  return entries.some(name => {
    const childTask = join(taskDir, name, 'task.md')
    return exists(childTask)
  })
}

/**
 * Деривує composite-стан з масиву станів дочірніх задач.
 * @param {string[]} childStates масив станів дочірніх задач
 * @returns {string} агрегований стан
 */
export function deriveCompositeState(childStates) {
  if (childStates.length === 0) return 'waiting'
  if (childStates.some(s => s === 'invalidated')) return 'invalidated'
  if (childStates.some(s => s === 'failed')) return 'failed'
  if (childStates.some(s => s === 'running')) return 'running'
  if (childStates.some(s => s === 'pending-audit')) return 'pending-audit'
  if (childStates.every(s => s === 'resolved')) return 'resolved'
  return 'waiting'
}

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
export function deriveNodeState(taskDir, activeWorktrees, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const readFile = deps.readFileSync ?? ((p, enc) => readFileSync(p, enc))
  const exists = deps.existsSync ?? existsSync

  // Файл task.md обов'язковий
  if (!exists(join(taskDir, 'task.md'))) {
    return 'needs-plan'
  }

  let files
  try {
    files = readdir(taskDir)
  } catch {
    return 'needs-plan'
  }

  const fileSet = new Set(files)

  // 1. invalidated — sentinel файл
  if (fileSet.has('invalidated')) return 'invalidated'

  // 2. pending-audit — є pending-audit_NNN.md без відповідного audit-result_NNN.md
  const { has: hasPending } = hasPendingAudit(taskDir, readdir)
  if (hasPending) return 'pending-audit'

  // 3. resolved — є fact_NNN.md і немає invalidated або незавершеного аудиту
  const factNNN = latestFactNNN(taskDir, readdir)
  if (factNNN !== null) return 'resolved'

  // 4. running — активний worktree існує (перевіряємо за prefix task dir name)
  const taskName = taskDir.split('/').findLast(Boolean) ?? ''
  if (activeWorktrees.size > 0) {
    for (const wt of activeWorktrees) {
      // worktree name: sanitized-task-path-epoch
      if (wt.includes(sanitizeTaskName(taskName))) return 'running'
    }
  }

  // 5. failed — є run_NNN.md з result:failed, без fact_NNN.md і без активного worktree
  const runFiles = files.filter(f => RUN_FILE_RE.test(f))
  if (runFiles.length > 0) {
    // Перевіряємо останній run файл
    let hasFailedRun = false
    for (const runFile of runFiles) {
      try {
        const content = readFile(join(taskDir, runFile), 'utf8')
        if (content.includes('result: failed') || content.includes('result:failed')) {
          hasFailedRun = true
        }
      } catch {
        // пропускаємо нечитабельні файли
      }
    }
    if (hasFailedRun) return 'failed'
  }

  // 6. waiting — є plan_NNN.md АБО mode:agent
  const hasPlan = files.some(f => PLAN_FILE_RE.test(f))
  if (hasPlan) return 'waiting'

  // Читаємо mode з task.md
  try {
    const taskContent = readFile(join(taskDir, 'task.md'), 'utf8')
    if (taskContent.includes('mode: agent')) return 'waiting'
  } catch {
    // пропускаємо
  }

  // 7. needs-plan — task.md є, mode:human (default), немає plan_NNN.md
  return 'needs-plan'
}

/**
 * Санітизує ім'я задачі для використання в назві worktree.
 * @param {string} name ім'я задачі (може містити /)
 * @returns {string} санітизоване ім'я
 */
export function sanitizeTaskName(name) {
  return name.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
}
