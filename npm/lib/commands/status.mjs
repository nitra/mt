/**
 * `mt status [<path>] [--json]` — показує стан задач.
 *
 * Без path — показує всі задачі. З path — лише задачу і її нащадків.
 * --json — machine-readable JSON вивід.
 *
 * FS ін'єктується для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveMtDir } from '../core/config.mjs'
import { scanTasks, topoSort } from '../core/scanner.mjs'
import { listActiveWorktrees } from '../core/worktree.mjs'

/** Кольори для стану (ANSI). */
const STATE_COLORS = {
  unassigned: '[33m', // жовтий
  pending: '[33m', // жовтий
  waiting: '[36m', // блакитний
  blocked: '[90m', // сірий
  'plan-review': '[33m', // жовтий
  spawned: '[36m', // блакитний
  running: '[34m', // синій
  stalled: '[90m', // сірий
  'pending-audit': '[35m', // фіолетовий
  resolved: '[32m', // зелений
  failed: '[31m', // червоний
  unresolvable: '[31m' // червоний
}
const RESET = '[0m'

/**
 * Повертає colored рядок стану (якщо TTY).
 * @param {string} state стан задачі
 * @param {boolean} color чи потрібен колір
 * @returns {string} рядок
 */
function colorState(state, color) {
  if (!color) return state
  const c = STATE_COLORS[state] ?? ''
  return `${c}${state}${RESET}`
}

/**
 * `mt status [<path>] [--json]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function status(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const execSyncFn = deps.execSync ?? ((cmd, opts) => execSync(cmd, { ...opts, encoding: 'utf8' }))

  // Парсимо аргументи
  let taskPath = null
  let jsonMode = false

  for (const arg of args) {
    if (arg === '--json') jsonMode = true
    else if (!arg.startsWith('-')) taskPath = arg
  }

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)

  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })

  const allNodes = scanTasks(mtDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  // Фільтруємо якщо є path
  let nodes = allNodes
  if (taskPath) {
    nodes = allNodes.filter(n => n.path === taskPath || n.path.startsWith(taskPath + '/'))
    if (nodes.length === 0) {
      log(`status: задача "${taskPath}" не знайдена`)
      return 1
    }
  }

  const sorted = topoSort(nodes)

  if (jsonMode) {
    console.log(
      JSON.stringify(
        sorted.map(n => ({
          id: n.id,
          path: n.path,
          state: n.state,
          deps: n.deps,
          composite: n.composite,
          children: n.children
        })),
        null,
        2
      )
    )
    return 0
  }

  // Текстовий вивід
  const useColor = process.stdout.isTTY ?? false

  // Підрахунок по станах
  const stateCounts = {}
  for (const n of sorted) {
    stateCounts[n.state] = (stateCounts[n.state] ?? 0) + 1
  }
  const summary = Object.entries(stateCounts)
    .map(([s, c]) => `${colorState(s, useColor)}:${c}`)
    .join(' ')

  log(`mt tasks — ${summary}`)
  log('')

  for (const node of sorted) {
    const indent = node.path.includes('/') ? '  '.repeat(node.path.split('/').length - 1) : ''
    const composite = node.composite ? ' [composite]' : ''
    const nodeDeps = node.deps.length > 0 ? ` ← [${node.deps.join(', ')}]` : ''
    log(`${indent}${node.path} [${colorState(node.state, useColor)}]${composite}${nodeDeps}`)
  }

  return 0
}
