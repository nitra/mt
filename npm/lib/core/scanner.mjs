/**
 * DAG-сканер задач.
 *
 * Рекурсивно обходить mt_dir, знаходить всі задачі (директорії з task.md),
 * читає їх залежності з task.md front-matter, деривує стани та виконує
 * топологічне сортування (Kahn's algorithm).
 *
 * FS ін'єктується. Нічого не пише на диск.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseFrontMatter } from './frontmatter.mjs'
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

    // Рекурсивно шукаємо дочірні директорії
    for (const name of entries) {
      // Пропускаємо зарезервовані та приховані директорії/файли
      if (name.startsWith('.') || name.includes('.')) continue
      const childDir = join(dir, name)
      // Перевіряємо що це директорія (якщо має subdirs або task.md)
      const childRelPath = prefix ? `${prefix}/${name}` : name
      try {
        // Перевірка що childDir — дійсно директорія
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
export function scanTasks(mtDir, activeWorktrees, deps = {}) {
  const readdir = deps.readdirSync ?? readdirSync
  const exists = deps.existsSync ?? existsSync
  const readFile = deps.readFileSync ?? ((p, enc) => readFileSync(p, enc))

  const found = findTasks(mtDir, { readdirSync: readdir, existsSync: exists, readFileSync: readFile })

  return found.map(({ dir, relPath }) => {
    let fm = {}
    try {
      const taskContent = readFile(join(dir, 'task.md'), 'utf8')
      fm = parseFrontMatter(taskContent)
    } catch {
      // порожній front-matter
    }

    const taskDeps = Array.isArray(fm.deps) ? fm.deps.map(String) : []
    const state = deriveNodeState(dir, activeWorktrees, {
      readdirSync: readdir,
      readFileSync: readFile,
      existsSync: exists
    })
    const composite = isComposite(dir, { readdirSync: readdir, existsSync: exists })

    // Дочірні задачі
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

  // Якщо є цикли — додаємо решту у кінець
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
