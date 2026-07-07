/**
 * `mt done <path>` — успіх → пише run_NNN.md (success), мерджить worktree.
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { nextRunNNN } from '../core/nnn.mjs'
import { loadConfig, resolveMtDir, resolveWorktreesDir } from '../core/config.mjs'
import { findTaskWorktree, mergeWorktree } from '../core/worktree.mjs'
import { resolveTaskPath, writeRunFile } from '../core/task-command.mjs'

/**
 * `mt done <path>` command handler.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function done(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))
  const nowFn = deps.now ?? (() => new Date().toISOString())

  const { taskPath, error } = resolveTaskPath(args, { env: deps.env, cwd: root, exists, readFile })
  if (!taskPath) {
    log(`done: ${error}`)
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)
  const worktreesDir = resolveWorktreesDir(config, root)
  const taskDir = join(mtDir, taskPath)

  if (!exists(join(taskDir, 'task.md'))) {
    log(`done: задача "${taskPath}" не знайдена`)
    return 1
  }

  // Записуємо run_NNN.md
  const nnn = nextRunNNN(taskDir, readdir)
  try {
    writeRunFile(taskDir, nnn, 'success', { actor: 'agent', now: nowFn() }, writeFile)
    log(`done: записано run_${nnn}.md (result: success)`)
  } catch (error) {
    log(`done: не вдалося записати run_${nnn}.md — ${error.message ?? String(error)}`)
    return 1
  }

  // Знаходимо і мерджимо worktree
  const worktreePath = findTaskWorktree(taskPath, worktreesDir, {
    readdirSync: readdir,
    execSync: execSyncFn
  })

  if (worktreePath) {
    const mergeResult = mergeWorktree(worktreePath, root, { execSync: execSyncFn })
    if (!mergeResult.ok) {
      log(`done: merge не вдався — ${mergeResult.error}`)
      return 1
    }
    log(`done: worktree merged і видалено`)
  } else {
    log(`done: worktree не знайдено для "${taskPath}" — пропускаємо merge`)
  }

  log(`done: задача "${taskPath}" успішно завершена`)
  return 0
}
