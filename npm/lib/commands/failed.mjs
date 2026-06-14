/**
 * `mt failed <path>` — провал → пише run_NNN.md (failed), залишає worktree.
 *
 * FS ін'єктується для тестованості.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { nextRunNNN } from '../core/nnn.mjs'
import { loadConfig, resolveMtDir } from '../core/config.mjs'
import { resolveTaskPath, writeRunFile } from '../core/task-command.mjs'

/**
 * `mt failed <path>` command handler.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function failed(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const nowFn = deps.now ?? (() => new Date().toISOString())

  const { taskPath, error } = resolveTaskPath(args, { env: deps.env })
  if (!taskPath) {
    log(`failed: ${error}`)
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)
  const taskDir = join(mtDir, taskPath)

  if (!exists(join(taskDir, 'task.md'))) {
    log(`failed: задача "${taskPath}" не знайдена`)
    return 1
  }

  // Записуємо run_NNN.md з result:failed
  const nnn = nextRunNNN(taskDir, readdir)
  try {
    writeRunFile(taskDir, nnn, 'failed', { actor: 'agent', now: nowFn() }, writeFile)
    log(`failed: записано run_${nnn}.md (result: failed)`)
  } catch (error) {
    log(`failed: не вдалося записати run_${nnn}.md — ${error.message ?? String(error)}`)
    return 1
  }

  log(`failed: задача "${taskPath}" позначена як failed — worktree збережено для діагностики`)
  return 0
}
