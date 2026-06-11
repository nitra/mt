/**
 * DAG-сканер задач.
 *
 * Рекурсивно обходить mt_dir, знаходить всі задачі (директорії з task.md),
 * читає їх залежності з deps/ директорії, деривує стани та виконує
 * топологічне сортування (Kahn's algorithm).
 *
 * FS ін'єктується. Нічого не пише на диск.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { deriveNodeState, isComposite } from './state.mjs'

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
 * Директорії, які пропускаються при рекурсивному скані.
 * deps/ — залежності (не вузли); history/ — архів; стандартні артефакти.
 */
const SKIP_DIRS = new Set(['deps', 'history', 'node_modules', 'target', 'dist', 'build'])

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
export function findTasks(mtDir, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync

  const tasks = []

  /**
   * Рекурсивно обходить директорію і додає знайдені задачі до `tasks`.
   * @param {string} dir абсолютний шлях до директорії
   * @param {string} [prefix] відносний шлях від mt_dir
   */
  function scan(dir, prefix = '') {
    let entries
    try {
      entries = readdir(dir)
    } catch {
      return
    }

    const hasTaskMd = entries.includes('task.md')
    if (hasTaskMd) {
      tasks.push({
        dir,
        relPath: prefix || dir.split('/').pop() || dir
      })
    }

    for (const name of entries) {
      // Пропускаємо файли (містять '.'), приховані директорії та зарезервовані директорії
      if (name.startsWith('.') || name.includes('.') || SKIP_DIRS.has(name)) continue
      const childDir = join(dir, name)
      const childRelPath = prefix ? `${prefix}/${name}` : name
      try {
        readdir(childDir)
        scan(childDir, childRelPath)
      } catch {
        // не директорія або не читається
      }
    }
  }

  scan(mtDir)
  return tasks
}

/**
 * Читає залежності вузла з директорії deps/.
 * ls -R deps/ → strip .md → dep-id (відносно mt/).
 * Cross-level: deps/research/analyze.md → dep-id = research/analyze.
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {(d: string) => string[]} readdir функція читання директорії
 * @returns {string[]} список dep-id
 */
function readDepsFromDir(taskDir, readdir) {
  return collectDeps(join(taskDir, 'deps'), '', readdir)
}

/**
 * Рекурсивно збирає dep-id з директорії deps/.
 * @param {string} dir поточна директорія
 * @param {string} prefix накопичений префікс шляху
 * @param {(d: string) => string[]} readdir функція читання директорії
 * @returns {string[]}
 */
function collectDeps(dir, prefix, readdir) {
  let entries
  try {
    entries = readdir(dir)
  } catch {
    return []
  }

  const deps = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    if (entry.endsWith('.md')) {
      // Файл залежності: strip .md → dep-id
      deps.push(prefix ? `${prefix}/${entry.slice(0, -3)}` : entry.slice(0, -3))
    } else {
      // Піддиректорія — крос-рівнева залежність
      const subDir = join(dir, entry)
      const subPrefix = prefix ? `${prefix}/${entry}` : entry
      try {
        readdir(subDir)
        deps.push(...collectDeps(subDir, subPrefix, readdir))
      } catch {
        // не директорія
      }
    }
  }
  return deps
}

/**
 * Сканує DAG і повертає всі задачі з деривованими станами.
 * Другий прохід: вузли з a.md та невирішеними deps → стан 'blocked'.
 * @param {string} mtDir абсолютний шлях до mt/
 * @param {Set<string>} activeWorktrees активні worktree імена
 * @param {{
 *   readdirSync?: (d: string) => string[],
 *   existsSync?: (p: string) => boolean,
 *   readFileSync?: (p: string, enc: string) => string,
 *   agentRetryMax?: number
 * }} [deps] ін'єкції
 * @returns {TaskInfo[]} список задач
 */
export function scanTasks(mtDir, activeWorktrees, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const exists = deps.existsSync ?? existsSync
  const readFile = deps.readFileSync ?? ((p, enc) => readFileSync(p, enc))
  const agentRetryMax = deps.agentRetryMax ?? 3

  const found = findTasks(mtDir, { readdirSync: readdir, existsSync: exists, readFileSync: readFile })

  const nodes = found.map(({ dir, relPath }) => {
    // Залежності — з директорії deps/, а не з task.md frontmatter
    const taskDeps = readDepsFromDir(dir, readdir)

    const state = deriveNodeState(dir, activeWorktrees, {
      readdirSync: readdir,
      readFileSync: readFile,
      existsSync: exists,
      relPath,
      agentRetryMax
    })

    const composite = isComposite(dir, { readdirSync: readdir, existsSync: exists })

    let children = []
    if (composite) {
      let entries
      try {
        entries = readdir(dir)
      } catch {
        entries = []
      }
      children = entries
        .filter(name => !name.startsWith('.') && !name.endsWith('.md') && !name.endsWith('.json'))
        .filter(name => {
          try {
            return exists(join(dir, name, 'task.md'))
          } catch {
            return false
          }
        })
        .map(name => `${relPath}/${name}`)
    }

    return {
      id: relPath,
      path: relPath,
      dir,
      deps: taskDeps,
      state,
      composite,
      children
    }
  })

  // Другий прохід: 'waiting' вузли з невирішеними deps → 'blocked'
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const node of nodes) {
    if (node.state === 'waiting' && node.deps.some(dep => nodeMap.get(dep)?.state !== 'resolved')) {
      node.state = 'blocked'
    }
  }

  return nodes
}

/**
 * Топологічне сортування задач (алгоритм Кана).
 * Задачі без залежностей — першими. Циклічні залежності — не гарантовано.
 * @param {TaskInfo[]} tasks задачі зі списком deps
 * @returns {TaskInfo[]} відсортований список (або той самий порядок якщо циклічні)
 */
export function topoSort(tasks) {
  const idToTask = new Map(tasks.map(t => [t.id, t]))
  const inDegree = new Map(tasks.map(t => [t.id, 0]))
  const adj = new Map(tasks.map(t => [t.id, []]))

  for (const task of tasks) {
    for (const dep of task.deps) {
      if (idToTask.has(dep)) {
        adj.get(dep).push(task.id)
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
      }
    }
  }

  const queue = tasks.filter(t => (inDegree.get(t.id) ?? 0) === 0).map(t => t.id)
  const sorted = []

  while (queue.length > 0) {
    const id = queue.shift()
    const task = idToTask.get(id)
    if (task) sorted.push(task)
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  if (sorted.length < tasks.length) {
    for (const t of tasks) {
      if (!sorted.includes(t)) sorted.push(t)
    }
  }

  return sorted
}

/**
 * Перевіряє чи всі залежності задачі resolved.
 * @param {TaskInfo} task задача
 * @param {Map<string, TaskInfo>} taskMap map id -> TaskInfo
 * @returns {boolean} true якщо всі deps resolved
 */
export function areDepsResolved(task, taskMap) {
  return task.deps.every(dep => {
    const depTask = taskMap.get(dep)
    return depTask?.state === 'resolved'
  })
}

/**
 * Знаходить активні worktrees з git worktree list.
 * @param {string} root корінь репо
 * @param {{ execSync?: (cmd: string, opts?: object) => string }} [deps] ін'єкції
 * @returns {Set<string>} set імен worktree
 */
export function getActiveWorktrees(root, deps = {}) {
  // eslint-disable-next-line sonarjs/os-command
  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, opts))
  try {
    const out = execSyncFn('git worktree list --porcelain', { cwd: root, encoding: 'utf8' })
    return parseWorktreeList(String(out))
  } catch {
    return new Set()
  }
}

/**
 * Парсить вивід `git worktree list --porcelain` і повертає набір імен worktree.
 * @param {string} output вивід команди
 * @returns {Set<string>} set імен (останній компонент шляху)
 */
export function parseWorktreeList(output) {
  const names = new Set()
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      const path = line.slice('worktree '.length).trim()
      const name = path.split('/').pop() ?? ''
      if (name) names.add(name)
    }
  }
  return names
}
