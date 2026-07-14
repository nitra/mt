/**
 * `mt init <name>` — створює task.md шаблон для нової задачі.
 *
 * Тонкий шим: уся ФС-логіка авторингу (mkdir + task.md + прапор a.md/h.md + deps/)
 * живе в Rust-крейті `mt-scanner` (підкоманда `create`) — єдине джерело істини,
 * симетрично до `scan`. Тут лише: резолв mtDir, виклик бінарника, парсинг JSON.
 *
 * Ім'я може містити `/` для вкладених задач (напр. "research/collect-data").
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveMtDir } from '../core/config.mjs'
import { scannerBin } from '../core/scanner-bin.mjs'
import { validateTaskName } from '../core/state.mjs'

/** Прапорці, що приймають значення (forward-only до бінарника). */
const VALUE_FLAGS = new Set(['--mode', '--model-tier', '--budget-sec', '--hint', '--dep'])

/**
 * Розбирає argv `mt init`: перший non-flag токен — ім'я, решта — прапорці
 * (прокидаються в бінарник вербатим; авторитетний парсинг — у Rust).
 * @param {string[]} args аргументи після `init`
 * @returns {{ name: string | null, flags: string[], error?: string }} розібране ім'я,
 *   список прапорців для бінарника та опційний текст помилки парсингу
 */
export function parseInitArgs(args) {
  let name = null
  const flags = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      flags.push(a)
      if (VALUE_FLAGS.has(a)) {
        const v = args[i + 1]
        if (v === undefined) return { name, flags, error: `init: прапор ${a} потребує значення` }
        flags.push(v)
        i++
      }
    } else if (name === null) {
      name = a
    } else {
      return { name, flags, error: `init: несподіваний аргумент ${a}` }
    }
  }
  return { name, flags }
}

/**
 * `mt init <name> [flags]` command handler.
 * @param {string[]} args аргументи: [name, ...flags]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   spawnSync?: typeof spawnSync,
 *   binPath?: string,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean
 * }} [deps] ін'єкції
 * @returns {number} exit code (0 створено/існує, 1 usage/помилка)
 */
export default function init(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const run = deps.spawnSync ?? spawnSync

  const parsed = parseInitArgs(args)
  if (parsed.error) {
    log(parsed.error)
    return 1
  }
  const { name, flags } = parsed
  if (!name) {
    log('Usage: mt init <name> [--mode agent|human] [--model-tier MIN|AVG|MAX]')
    log('                      [--budget-sec N] [--hint <text>] [--dep <id>]...')
    log('  name може містити / для вкладених задач (напр. "research/collect-data")')
    return 1
  }

  const nameErr = validateTaskName(name)
  if (nameErr) {
    log(`init: невалідне ім'я — ${nameErr}`)
    return 1
  }

  const config = loadConfig({ root, readFile: deps.readFile, exists: deps.exists })
  const mtDir = resolveMtDir(config, root)
  const bin = deps.binPath ?? scannerBin()

  const res = run(bin, ['create', mtDir, name, ...flags], { encoding: 'utf8' })
  if (res.error) {
    log(`init: не вдалося запустити mt-scanner — ${res.error.message ?? String(res.error)}`)
    return 1
  }
  if (res.status !== 0) {
    log(`init: mt-scanner завершився з помилкою (exit ${res.status}): ${(res.stderr ?? '').trim()}`)
    return 1
  }

  let out
  try {
    out = JSON.parse(res.stdout)
  } catch {
    log('init: некоректний JSON від mt-scanner')
    return 1
  }

  const taskPath = join(mtDir, out.task_path)
  if (out.created) {
    log(`init: створено ${taskPath} (прапор ${out.flag})`)
  } else {
    log(`init: ${taskPath} вже існує — пропускаємо`)
  }
  return 0
}
