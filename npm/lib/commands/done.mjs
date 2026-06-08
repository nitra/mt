/**
 * `mt done <path>` — успіх → пише run_NNN.md (success), мерджить worktree.
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown } from '../core/frontmatter.mjs'
import { nextRunNNN } from '../core/nnn.mjs'
import { loadConfig, resolveMtDir, resolveWorktreesDir } from '../core/config.mjs'
import { findTaskWorktree, mergeWorktree } from '../core/worktree.mjs'

/**
 * Пише run_NNN.md артефакт.
 * @param {string} taskDir директорія задачі
 * @param {string} nnn NNN рядок
 * @param {'success'|'failed'} result результат
 * @param {{ actor: string, now: string }} meta метадані
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
function writeRunFile(taskDir, nnn, result, meta, writeFile) {
  const fm = {
    created_at: meta.now,
    actor: meta.actor,
    result
  }
  const content = buildMarkdown(fm, `## Run ${nnn}\n\nactor: ${meta.actor}\nresult: ${result}\n`)
  writeFile(join(taskDir, `run_${nnn}.md`), content, 'utf8')
}

/**
 * Резолвить шлях задачі з аргументів або env/fallback-файлу.
 * @param {string[]} args аргументи командного рядка
 * @param {{ env?: Record<string, string>, cwd?: string, exists?: (p: string) => boolean, readFile?: (p: string, enc: string) => string }} deps ін'єкції
 * @returns {{ taskPath: string | null, error: string | null }} результат
 */
function resolveTaskPath(args, deps) {
  // 1. Прямий аргумент
  if (args[0] && !args[0].startsWith('-')) {
    return { taskPath: args[0], error: null }
  }

  // 2. ENV var
  const env = deps.env ?? process.env
  const fromEnv = env['MT_TASK_PATH']
  if (fromEnv?.trim()) {
    return { taskPath: fromEnv.trim(), error: null }
  }

  return { taskPath: null, error: 'MT_TASK_PATH not set' }
}

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
  // eslint-disable-next-line sonarjs/os-command
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
