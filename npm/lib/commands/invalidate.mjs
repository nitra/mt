/**
 * `mt invalidate <path> [--no-cascade]` — позначає задачу як invalidated.
 *
 * Записує порожній файл `invalidated` у директорію задачі.
 * За замовчуванням каскадно інвалідує всі залежні задачі.
 * --no-cascade — лише поточна задача.
 *
 * FS ін'єктується для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveMtDir } from '../core/config.mjs'
import { scanTasks } from '../core/scanner.mjs'
import { listActiveWorktrees } from '../core/worktree.mjs'

/**
 * `mt invalidate <path> [--no-cascade]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function invalidate(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))

  let taskPath = null
  let noCascade = false

  for (const arg of args) {
    if (arg === '--no-cascade') noCascade = true
    else if (!arg.startsWith('-')) taskPath = arg
  }

  if (!taskPath) {
    log('Usage: mt invalidate <path> [--no-cascade]')
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)
  const taskDir = join(mtDir, taskPath)

  if (!exists(join(taskDir, 'task.md'))) {
    log(`invalidate: задача "${taskPath}" не знайдена`)
    return 1
  }

  // Записуємо invalidated sentinel
  try {
    writeFile(join(taskDir, 'invalidated'), '', 'utf8')
    log(`invalidate: задача "${taskPath}" інвалідована`)
  } catch (error) {
    log(`invalidate: не вдалося записати invalidated — ${error.message ?? String(error)}`)
    return 1
  }

  if (noCascade) return 0

  // Каскадна інвалідація
  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })
  const allNodes = scanTasks(mtDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  const dependents = allNodes.filter(n => n.deps.includes(taskPath))
  for (const dep of dependents) {
    if (!exists(join(dep.dir, 'invalidated'))) {
      try {
        writeFile(join(dep.dir, 'invalidated'), '', 'utf8')
        log(`invalidate: каскадна інвалідація "${dep.path}"`)
      } catch {
        // пропускаємо
      }
    }
  }

  return 0
}
