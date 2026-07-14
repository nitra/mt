/**
 * `mt run [<path>] [--actor a] [--auto]` — тонкий клієнт Rust-раннера.
 *
 * Уся run-оркестрація живе в mt-core (crates/mt-core/src/runner.rs через
 * napi-аддон) — правило одного коду контракту (stack.md): CAS claim →
 * detached worktree від `origin/main` → виконавець → watchdog (hard budget,
 * progress-timeout) → спільний `## Check`-гейт → fenced publish в
 * `origin/main`. Вимагає git-репозиторій з push-доступом до `origin`.
 *
 * Виконавці (резолвить Rust-ядро):
 * - **підписочні CLI** (`agent_cli`: claude | codex | cursor | pi) з
 *   user-level ENV-конфігом (`MT_AGENT_CLI`, `MT_CLOUD_AGENT_CLIS`,
 *   `MT_AGENT_CLI_MODEL_MAP`), per-node override — `a.md` «## Agent cli»;
 *   вичерпані ліміти підписки (rate limit / quota / 429) → каскад
 *   `MT_CLOUD_AGENT_CLIS`; фактичний CLI — у frontmatter `run_NNN.md`;
 * - **зовнішній екзекутор** (`.mt.json` `node_executor`) — замінює CLI-шлях,
 *   fact синтезує runner зі stdout-контракту `{ applied, touchedFiles }`;
 * - тир MIN/AVG/MAX і retry ladder (`## Model tier` / `## Retry ladder` в
 *   `a.md`) — ескалацію застосовує Rust-ядро (env `MT_MODEL_TIER`,
 *   `MT_RETRY_STRATEGY`, `MT_ATTEMPT`).
 *
 * У JS лишаються: парсинг argv, резолв `mt_dir`, human-шлях (інструкції без
 * спавну і без claim) і мапінг помилок раннера в exit-коди
 * (claim-lost → 2 — «інший runner виграв», не збій).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveMtDir } from '../core/config.mjs'
import { loadNative } from '../core/native.mjs'

/**
 * Розбирає argv `mt run`: перший non-flag токен — шлях задачі.
 * @param {string[]} args аргументи після `run`
 * @returns {{ taskPath: string | null, actor: string | null, autoMode: boolean }} розібрані параметри
 */
function parseRunArgs(args) {
  let taskPath = null
  let actor = null
  let autoMode = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--actor' && args[i + 1]) {
      actor = args[i + 1]
      i++
    } else if (args[i] === '--auto') {
      autoMode = true
    } else if (!args[i].startsWith('-')) {
      taskPath = args[i]
    }
  }
  return { taskPath, actor, autoMode }
}

/**
 * `--auto`: делегує оркестраторний прохід Rust-ядру (waiting-агентські вузли
 * чергами по `agent_concurrency`). claim-lost/preflight-відмови — штатний
 * skip (Rust-раннер сам веде skip-set), не провал прогону.
 * @param {{ runAuto: (mtDir: string, concurrency: number) => object[] }} native napi-аддон
 * @param {string} mtDir абсолютний шлях tasks-директорії
 * @param {number} concurrency `agent_concurrency` з конфігу
 * @param {(m: string) => void} log лог
 * @returns {number} exit code
 */
function runAutoMode(native, mtDir, concurrency, log) {
  let results
  try {
    results = native.runAuto(mtDir, concurrency)
  } catch (error) {
    log(`run --auto: ${error.message ?? String(error)}`)
    return 1
  }
  if (results.length === 0) {
    log('run --auto: немає готових задач для запуску')
    return 0
  }
  let anyFailed = false
  for (const r of results) {
    const detail = r.error ? ` (${r.error})` : ''
    log(`run --auto: ${r.path} → ${r.result}${detail}`)
    if (r.result !== 'success' && !r.error?.includes('claim-lost')) anyFailed = true
  }
  return anyFailed ? 1 : 0
}

/**
 * `mt run [<path>] [--actor a] [--auto]` command handler.
 * @param {string[]} args аргументи
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean,
 *   native?: {
 *     runNode: (mtDir: string, taskPath: string) => object,
 *     runAuto: (mtDir: string, concurrency: number) => object[]
 *   }
 * }} [deps] ін'єкції
 * @returns {number} exit code
 */
export default function run(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const exists = deps.exists ?? existsSync
  const native = deps.native ?? loadNative()

  const { taskPath, actor, autoMode } = parseRunArgs(args)

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)

  if (autoMode) {
    return runAutoMode(native, mtDir, config.agent_concurrency, log)
  }

  if (!taskPath) {
    log('run: вкажіть <path> або використайте --auto')
    log('Usage: mt run [<path>] [--actor agent|human] [--auto]')
    return 1
  }

  const taskDir = join(mtDir, taskPath)
  if (!exists(join(taskDir, 'task.md'))) {
    log(`run: задача "${taskPath}" не знайдена (немає task.md у ${taskDir})`)
    return 1
  }

  // Людина виконує вручну — без спавну і без claim; фіксація — `mt done`.
  if (actor === 'human' || actor === 'h') {
    log(`run: задача "${taskPath}" очікує ручного виконання`)
    log(`     директорія: ${taskDir}`)
    log(`     після виконання запустіть: mt done ${taskPath}`)
    return 0
  }

  let outcome
  try {
    outcome = native.runNode(mtDir, taskPath)
  } catch (error) {
    const message = error.message ?? String(error)
    log(`run: ${message}`)
    // claim-lost — «інший runner виграв», штатний skip, не системний збій.
    return message.includes('claim-lost') ? 2 : 1
  }

  const cli = outcome.agent_cli ? `, agent_cli=${outcome.agent_cli}` : ''
  log(`run: "${taskPath}" → ${outcome.result} (${outcome.run_file}, ${outcome.wall_sec}s${cli})`)
  if (outcome.result === 'success') {
    log(`run: опубліковано в origin/main (${outcome.fact_file})`)
    return 0
  }
  log(`run: задача "${taskPath}" завершилась з помилкою — діагностика у ${outcome.run_file}`)
  return 1
}
