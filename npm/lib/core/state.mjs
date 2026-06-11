/**
 * Деривація стану задачі з файлової системи (immutable file-presence protocol).
 *
 * Стан — derived: durable lifecycle визначається артефактами вузла.
 * Пріоритет (відповідно до специфікації):
 *   pending-audit > resolved > unresolvable > (stalled — потребує remote) >
 *   running > plan-review > spawned > waiting/blocked > pending > unassigned > failed
 *
 * Чиста функція — FS ін'єктується. Нічого не пише на диск.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseFrontMatter } from './frontmatter.mjs'

const RUN_FILE_RE = /^run_(\d+)\.md$/
const FACT_FILE_RE = /^fact_(\d+)\.md$/
const PLAN_FILE_RE = /^plan_(\d+)\.md$/
/** Локальний runtime marker running_<pid>_until_<ts>. */
const RUNNING_MARKER_RE = /^running_\d+_until_/

/** Всі можливі стани задачі відповідно до специфікації. */
export const NODE_STATES = /** @type {const} */ ([
  'unassigned',
  'pending',
  'waiting',
  'blocked',
  'plan-review',
  'spawned',
  'running',
  'stalled',
  'pending-audit',
  'resolved',
  'failed',
  'unresolvable'
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

  return entries.some(name => exists(join(taskDir, name, 'task.md')))
}

/**
 * Санітизує ім'я задачі для використання в назві worktree.
 * @param {string} name ім'я задачі (може містити /)
 * @returns {string} санітизоване ім'я
 */
export function sanitizeTaskName(name) {
  return name.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
}

/**
 * Знаходить максимальний NNN серед файлів що відповідають regex.
 * @param {string[]} files список файлів
 * @param {RegExp} re regex з групою захоплення числа
 * @returns {number} максимальний NNN або 0
 */
function maxNNNFromFiles(files, re) {
  let max = 0
  for (const f of files) {
    const m = f.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max
}

/**
 * Обчислює failed_streak з імен файлів — без читання вмісту.
 * failed_streak = max(NNN серед run_*.md) - max(NNN серед fact_*.md; 0 якщо немає)
 * @param {string[]} files список файлів директорії
 * @returns {number} лічильник поточної серії невдач
 */
function computeFailedStreak(files) {
  return maxNNNFromFiles(files, RUN_FILE_RE) - maxNNNFromFiles(files, FACT_FILE_RE)
}

/**
 * Визначає стан актуального fact_NNN.md: 'pending-audit', 'resolved', або null.
 *
 * Єдиний виняток із правила "стан з імен файлів": читає frontmatter audit-result_NNN.md
 * лише якщо він існує — для визначення result: success | failed.
 *
 * @param {string} taskDir шлях до директорії задачі
 * @param {string[]} files список файлів
 * @param {(p: string, enc: string) => string} readFile функція читання файлу
 * @returns {'pending-audit' | 'resolved' | null}
 */
function getAcceptedFactState(taskDir, files, readFile) {
  const maxFact = maxNNNFromFiles(files, FACT_FILE_RE)
  if (maxFact === 0) return null

  const nnnStr = String(maxFact).padStart(3, '0')
  const fileSet = new Set(files)
  const pendingAuditFile = `pending-audit_${nnnStr}.md`

  if (!fileSet.has(pendingAuditFile)) return 'resolved'

  const auditResultFile = `audit-result_${nnnStr}.md`
  if (!fileSet.has(auditResultFile)) return 'pending-audit'

  try {
    const fm = parseFrontMatter(readFile(join(taskDir, auditResultFile), 'utf8'))
    return fm.result === 'success' ? 'resolved' : null
  } catch {
    return null
  }
}

/**
 * Визначає composite-стан плану: 'plan-review', 'spawned', або null.
 * Читає frontmatter актуального plan_NNN.md для перевірки decision: composite.
 *
 * @param {string} taskDir шлях до директорії задачі
 * @param {string[]} files список файлів
 * @param {Set<string>} fileSet сет файлів
 * @param {(p: string, enc: string) => string} readFile функція читання
 * @param {(d: string) => string[]} readdir функція readdir
 * @param {(p: string) => boolean} exists функція existsSync
 * @returns {'plan-review' | 'spawned' | null}
 */
function getCompositePlanState(taskDir, files, fileSet, readFile, readdir, exists) {
  const maxPlan = maxNNNFromFiles(files, PLAN_FILE_RE)
  if (maxPlan === 0) return null

  const nnnStr = String(maxPlan).padStart(3, '0')

  let decision = 'atomic'
  try {
    const fm = parseFrontMatter(readFile(join(taskDir, `plan_${nnnStr}.md`), 'utf8'))
    decision = fm.decision ?? 'atomic'
  } catch {
    // дефолт atomic
  }

  if (decision !== 'composite') return null

  const hasApproved = fileSet.has(`plan-approved_${nnnStr}.md`)
  const hasRejected = fileSet.has(`plan-rejected_${nnnStr}.md`)

  if (!hasApproved && !hasRejected) return 'plan-review'
  if (hasApproved && isComposite(taskDir, { readdirSync: readdir, existsSync: exists })) return 'spawned'

  return null
}

/**
 * Деривує стан однієї задачі з присутності файлів.
 *
 * `blocked` встановлюється зовнішнім другим проходом у scanTasks
 * (потребує станів усіх dep-вузлів). З цієї функції `a.md`-вузол
 * повертає 'waiting'; scanTasks перевизначає на 'blocked' якщо потрібно.
 *
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {Set<string>} activeWorktrees set імен активних worktree
 * @param {{
 *   agentRetryMax?: number,
 *   relPath?: string,
 *   readdirSync?: (d: string) => string[],
 *   readFileSync?: (p: string, enc: string) => string,
 *   existsSync?: (p: string) => boolean
 * }} [deps] ін'єкції та параметри
 * @returns {string} стан задачі
 */
export function deriveNodeState(taskDir, activeWorktrees, deps = {}) {
  const agentRetryMax = deps.agentRetryMax ?? 3
  const readdir = deps.readdirSync ?? readdirSync
  const readFile = deps.readFileSync ?? ((p, enc) => readFileSync(p, enc))
  const exists = deps.existsSync ?? existsSync

  if (!exists(join(taskDir, 'task.md'))) return 'unassigned'

  let files
  try {
    files = readdir(taskDir)
  } catch {
    return 'unassigned'
  }
  const fileSet = new Set(files)

  // 1 + 2. pending-audit / resolved — через прийнятий fact
  const factState = getAcceptedFactState(taskDir, files, readFile)
  if (factState === 'pending-audit') return 'pending-audit'
  if (factState === 'resolved') return 'resolved'

  // 3. unresolvable — термінальний маркер-файл
  if (fileSet.has('unresolvable.md')) return 'unresolvable'

  // 4. stalled — потребує remote claim ref; пропускаємо в локальному скані

  // 5. running — локальний running_<pid>_until_<ts> маркер або активний worktree
  const hasRunningMarker = files.some(f => RUNNING_MARKER_RE.test(f))
  const relPath = deps.relPath ?? taskDir.split('/').findLast(Boolean) ?? ''
  const sanitizedPath = sanitizeTaskName(relPath.replaceAll('/', '-'))
  const hasActiveWorktree =
    sanitizedPath.length > 0 && [...activeWorktrees].some(wt => wt.startsWith(sanitizedPath))
  if (hasRunningMarker || hasActiveWorktree) return 'running'

  // 6 + 7. plan-review / spawned — composite план без approve або з approve + дітьми
  const compositePlanState = getCompositePlanState(taskDir, files, fileSet, readFile, readdir, exists)
  if (compositePlanState) return compositePlanState

  // 8. waiting / failed — a.md визначає виконавця (агент)
  if (fileSet.has('a.md')) {
    const streak = computeFailedStreak(files)
    if (streak >= agentRetryMax) return 'failed'
    return 'waiting'
  }

  // 9. pending — h.md визначає виконавця (людина)
  if (fileSet.has('h.md')) return 'pending'

  // 10. unassigned — немає виконавця
  return 'unassigned'
}
