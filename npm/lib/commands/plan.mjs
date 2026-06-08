/**
 * `mt plan [<path>] [--mode agent]` — Stage 1: пише plan_NNN.md.
 *
 * Читає task.md задачі, знаходить наступний NNN, пише шаблон plan_NNN.md.
 * Якщо --mode agent — встановлює mode:agent у plan front-matter.
 *
 * FS ін'єктується для тестованості.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown, parseFrontMatter } from '../core/frontmatter.mjs'
import { nextPlanNNN } from '../core/nnn.mjs'
import { loadConfig, resolveMtDir } from '../core/config.mjs'

/**
 * Будує шаблон plan_NNN.md.
 * @param {{ mode: string, hint: string, now: string, nnn: string }} params параметри
 * @returns {string} вміст файлу
 */
export function buildPlanTemplate(params) {
  const fm = {
    created_at: params.now,
    mode: params.mode,
    decision: params.hint || 'atomic'
  }

  const body = [
    `## Context`,
    `<!-- Чому саме такий підхід — що з'ясовано під час планування -->`,
    ``,
    `## Approach`,
    params.mode === 'composite'
      ? `<!-- composite: список дочірніх задач з описами -->`
      : `<!-- atomic: покроковий план виконання -->`,
    ``,
    `## Risks`,
    `<!-- Що може піти не так -->`,
    ``
  ].join('\n')

  return buildMarkdown(fm, body)
}

/**
 * `mt plan [<path>] [--mode agent]` command handler.
 * @param {string[]} args аргументи: [path] [--mode agent|human]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function plan(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const nowFn = deps.now ?? (() => new Date().toISOString())

  // Парсимо аргументи
  let taskPath = null
  let modeOverride = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode' && args[i + 1]) {
      modeOverride = args[i + 1]
      i++
    } else if (!args[i].startsWith('-')) {
      taskPath = args[i]
    }
  }

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)

  // Визначаємо директорію задачі
  let taskDir
  if (taskPath) {
    taskDir = join(mtDir, taskPath)
  } else {
    // CWD може бути в worktree — шукаємо task.md у CWD
    taskDir = processCwd()
  }

  const taskFilePath = join(taskDir, 'task.md')
  if (!exists(taskFilePath)) {
    log(`plan: task.md не знайдено в ${taskDir}`)
    return 1
  }

  let taskContent
  try {
    taskContent = readFile(taskFilePath, 'utf8')
  } catch (error) {
    log(`plan: не вдалося прочитати task.md — ${error.message ?? String(error)}`)
    return 1
  }

  const fm = parseFrontMatter(taskContent)
  const mode = modeOverride ?? (typeof fm.mode === 'string' ? fm.mode : 'human')
  const hint = typeof fm.hint === 'string' ? fm.hint : ''

  const nnn = nextPlanNNN(taskDir, readdir)
  const planPath = join(taskDir, `plan_${nnn}.md`)

  const content = buildPlanTemplate({ mode, hint, now: nowFn(), nnn })

  try {
    writeFile(planPath, content, 'utf8')
    log(`plan: створено ${planPath} (mode: ${mode})`)
  } catch (error) {
    log(`plan: не вдалося записати ${planPath} — ${error.message ?? String(error)}`)
    return 1
  }

  // Виводимо контекст для агента/людини
  const bodyStart = taskContent.indexOf('\n---\n', 4)
  const taskBody = bodyStart === -1 ? taskContent : taskContent.slice(bodyStart + 5).trimStart()

  console.log(
    [
      `## plan context`,
      ``,
      `task: ${taskPath ?? taskDir}`,
      `mode: ${mode}`,
      hint ? `hint: ${hint}` : `hint: (не задано)`,
      `plan: plan_${nnn}.md`,
      ``,
      `### task.md`,
      taskBody.trimEnd()
    ].join('\n')
  )

  return 0
}
