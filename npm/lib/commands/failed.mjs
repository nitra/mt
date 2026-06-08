/**
 * `mt failed <path>` — провал → пише run_NNN.md (failed), залишає worktree.
 *
 * FS ін'єктується для тестованості.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown } from '../core/frontmatter.mjs'
import { nextRunNNN } from '../core/nnn.mjs'
import { loadConfig, resolveMtDir } from '../core/config.mjs'

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
 * Резолвить шлях задачі з аргументів або env.
 * @param {string[]} args аргументи командного рядка
 * @param {{ env?: Record<string, string> }} deps ін'єкції
 * @returns {{ taskPath: string | null, error: string | null }} результат
 */
function resolveTaskPath(args, deps) {
  if (args[0] && !args[0].startsWith('-')) {
    return { taskPath: args[0], error: null }
  }

  const env = deps.env ?? process.env
  const fromEnv = env['MT_TASK_PATH']
  if (fromEnv?.trim()) {
    return { taskPath: fromEnv.trim(), error: null }
  }

  return { taskPath: null, error: 'MT_TASK_PATH not set' }
}

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
