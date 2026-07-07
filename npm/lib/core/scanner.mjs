/**
 * DAG-сканер задач — тонкий шим над Rust-ядром mt-core.
 *
 * Уся робота з файловою системою (обхід задач, деривація станів, worktree→running)
 * виконується в Rust. За замовчуванням — прямий виклик napi-аддона (native.mjs);
 * транзиційний шлях через бінарник `mt-scanner` лишається для ін'єкцій тестів
 * (binPath/spawnSync) та явного override MT_SCANNER_BIN. Цей модуль лише приводить
 * JSON-дерево до плоского контракту команд, плюс чисто-графові операції (топосорт).
 */
import { execSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { env as procEnv } from 'node:process'

import { loadNative } from './native.mjs'
import { scannerBin } from './scanner-bin.mjs'

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
 * @typedef {(
 *   bin: string,
 *   args: string[],
 *   opts: object
 * ) => { status: number | null, stdout: string, stderr: string, error?: Error }} SpawnSyncFn
 */

/** Максимальний розмір stdout бінарника (великі графи). */
const MAX_BUFFER = 64 * 1024 * 1024

/**
 * Рекурсивно сплющує вкладене дерево `TaskNode` (Rust) у плоский список `TaskInfo`.
 * Кожен вузол (включно з дітьми) стає окремим записом; `children` — масив шляхів.
 * @param {object[]} tree вузли від бінарника
 * @param {string} mtDir абсолютний шлях до mt/
 * @param {TaskInfo[]} [out] акумулятор
 * @returns {TaskInfo[]} плоский список задач
 */
function flatten(tree, mtDir, out = []) {
  for (const node of tree) {
    out.push({
      id: node.path,
      path: node.path,
      dir: join(mtDir, node.path),
      deps: node.deps ?? [],
      // snake_case (Rust serde) → kebab-case (контракт команд): plan_review → plan-review
      state: String(node.state).replaceAll('_', '-'),
      composite: Boolean(node.is_composite),
      children: (node.children ?? []).map(c => c.path)
    })
    if (node.children?.length) flatten(node.children, mtDir, out)
  }
  return out
}

/**
 * Запускає `mt-scanner scan` і повертає сплющений список задач.
 * @param {string} mtDir абсолютний шлях до mt/
 * @param {Set<string> | string[] | undefined} activeWorktrees активні worktree (опційно).
 *   Якщо передані — прокидуються в бінарник через --worktrees (уникає повторного git);
 *   якщо ні — бінарник сам виявляє worktree через `git worktree list`.
 * @param {{ binPath?: string, spawnSync?: SpawnSyncFn }} [deps] ін'єкції для тестів
 * @returns {TaskInfo[]} плоский список задач
 */
function runScanner(mtDir, activeWorktrees, deps = {}) {
  // Транзиційний subprocess-шлях: лише для ін'єкцій тестів або явного override.
  const useSubprocess = deps.binPath || deps.spawnSync || procEnv.MT_SCANNER_BIN
  if (!useSubprocess) {
    // Порожній список === відсутній --worktrees у CLI: аддон сам виявляє через git.
    const wtList = activeWorktrees ? [...activeWorktrees] : []
    return flatten(loadNative().scanTasks(mtDir, wtList.length > 0 ? wtList : null), mtDir)
  }

  const bin = deps.binPath ?? scannerBin()
  const run = deps.spawnSync ?? spawnSync

  const wtList = activeWorktrees ? [...activeWorktrees] : []
  const args = ['scan', mtDir]
  if (wtList.length > 0) args.push('--worktrees', wtList.join(','))

  const res = run(bin, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER })
  if (res.error) throw res.error
  if (res.status !== 0) {
    throw new Error(`mt-scanner failed (exit ${res.status}): ${res.stderr ?? ''}`)
  }

  return flatten(JSON.parse(res.stdout), mtDir)
}

/**
 * Знаходить усі задачі DAG у mt_dir (директорії з task.md).
 * @param {string} mtDir абсолютний шлях до mt/
 * @param {{ binPath?: string, spawnSync?: SpawnSyncFn }} [deps] ін'єкції
 * @returns {{ dir: string, relPath: string }[]} список знайдених задач
 */
export function findTasks(mtDir, deps = {}) {
  return runScanner(mtDir, undefined, deps).map(n => ({ dir: n.dir, relPath: n.path }))
}

/**
 * Сканує DAG і повертає всі задачі з деривованими станами (включно з blocked та
 * worktree→running — усе обчислює бінарник).
 * @param {string} mtDir абсолютний шлях до mt/
 * @param {Set<string>} activeWorktrees активні worktree імена (опційно)
 * @param {{ binPath?: string, spawnSync?: SpawnSyncFn }} [deps] ін'єкції
 * @returns {TaskInfo[]} список задач
 */
export function scanTasks(mtDir, activeWorktrees, deps = {}) {
  return runScanner(mtDir, activeWorktrees, deps)
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
      if (!idToTask.has(dep)) {
        continue
      }

      adj.get(dep).push(task.id)
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
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
    if (!line.startsWith('worktree ')) {
      continue
    }

    const path = line.slice('worktree '.length).trim()
    const name = path.split('/').pop() ?? ''
    if (name) names.add(name)
  }
  return names
}
