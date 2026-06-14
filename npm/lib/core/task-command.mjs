/**
 * Спільні хелпери команд переходу стану задачі (`audit`/`done`/`failed`).
 *
 * Винесено сюди, щоб уникнути дублювання логіки між командами (єдине джерело
 * формату `run_NNN.md` і резолву шляху задачі).
 */
import { join } from 'node:path'

import { buildMarkdown } from './frontmatter.mjs'

/**
 * Пише run_NNN.md артефакт.
 * @param {string} taskDir директорія задачі
 * @param {string} nnn NNN рядок
 * @param {'success'|'failed'} result результат
 * @param {{ actor: string, now: string }} meta метадані
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
export function writeRunFile(taskDir, nnn, result, meta, writeFile) {
  const fm = {
    created_at: meta.now,
    actor: meta.actor,
    result
  }
  const content = buildMarkdown(fm, `## Run ${nnn}\n\nactor: ${meta.actor}\nresult: ${result}\n`)
  writeFile(join(taskDir, `run_${nnn}.md`), content, 'utf8')
}

/**
 * Резолвить шлях задачі з аргументів або env (`MT_TASK_PATH`).
 * @param {string[]} args аргументи командного рядка
 * @param {{ env?: Record<string, string> }} [deps] ін'єкції
 * @returns {{ taskPath: string | null, error: string | null }} результат
 */
export function resolveTaskPath(args, deps = {}) {
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
