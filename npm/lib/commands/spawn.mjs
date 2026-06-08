/**
 * `mt spawn <path>` — composite → перевіряє що дочірні задачі зареєстровані.
 *
 * FS ін'єктується для тестованості.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveMtDir } from '../core/config.mjs'

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
 * `mt spawn <path>` command handler.
 * @param {string[]} args аргументи
 * @param {object} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function spawn(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const { taskPath, error } = resolveTaskPath(args, { env: deps.env })
  if (!taskPath) {
    log(`spawn: ${error}`)
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)
  const taskDir = join(mtDir, taskPath)

  if (!exists(join(taskDir, 'task.md'))) {
    log(`spawn: задача "${taskPath}" не знайдена`)
    return 1
  }

  // Перевіряємо дочірні директорії
  let entries
  try {
    entries = readdir(taskDir)
  } catch {
    log(`spawn: не вдалося прочитати директорію задачі`)
    return 1
  }

  const childDirs = entries.filter(name => {
    if (name.startsWith('.') || name.endsWith('.md') || name.endsWith('.json')) return false
    return exists(join(taskDir, name, 'task.md'))
  })

  if (childDirs.length === 0) {
    log(`spawn: задача "${taskPath}" не має дочірніх задач із task.md`)
    log(`spawn: для composite задачі треба створити дочірні директорії з task.md`)
    return 1
  }

  log(`spawn: задача "${taskPath}" є composite з ${childDirs.length} дочірніми задачами:`)
  for (const child of childDirs) {
    log(`  - ${taskPath}/${child}`)
  }

  return 0
}
