/**
 * `mt run [<path>] [--actor a] [--auto]` — запуск задачі(задач).
 *
 * Wrapper логіка:
 * 1. Читає task.md → budget_sec, budget_hard_sec, deps, mode, executor
 * 2. Перевіряє що всі deps resolved
 * 3. Обчислює NNN = count(run_*.md) + 1
 * 4. git worktree add .worktrees/<task-epoch>/ (atomic mkdir lock — EEXIST = skip)
 * 5. ENV: MT_RUN_NNN, MT_BUDGET_SEC, MT_HARD_BUDGET_SEC, MT_STARTED_AT, MT_TASK_PATH,
 *    MT_NODE_DIR, MT_WORKTREE, MT_RUN_TOKEN, MT_MODEL_TIER
 * 6. Спавнить subprocess: вбудований Claude-agent-шлях АБО (якщо `.mt.json`
 *    `node_executor` заданий) — зовнішня команда-екзекутор (див. нижче)
 * 7. Після exit: fact_NNN.md є → result:success; else → result:failed
 * 8. Пише run_NNN.md
 * 9. Якщо success: git merge + delete worktree
 *
 * ## Точка розширення: зовнішній екзекутор вузла (`node_executor`)
 *
 * `.mt.json` `node_executor` (рядок-команда, напр. `npx n-cursor mt-run-node`)
 * замінює вбудований Claude-agent-шлях для actor=agent. Мотивація: зовнішній консюмер
 * виконує вузли ВЛАСНИМ harness-ом (свої моделі/тири, власна телеметрія) замість
 * Claude-моделей `.mt.json` model_map. MT лишає за собою всю оркестрацію
 * (claim/lease, worktree-ізоляція, budget/timeout, ## Check, fenced publish);
 * екзекутор ЛИШЕ «застосуй зміни у worktree».
 *
 * Контракт команди-екзекутора:
 * - argv: `<node_executor...> <node-dir>` — абсолютний шлях директорії вузла у worktree;
 * - env: MT_NODE_DIR, MT_WORKTREE, MT_RUN_TOKEN, MT_MODEL_TIER, MT_TASK_PATH,
 *   MT_RUN_NNN, MT_BUDGET_SEC, MT_HARD_BUDGET_SEC, MT_STARTED_AT;
 * - stdout: остання непорожня лінія = JSON `{ applied: bool, touchedFiles: string[] }`;
 * - exit 0 → runner ганяє ## Check (якщо є) і за успіху синтезує `fact_NNN.md`
 *   (екзекутор його НЕ пише) → штатний merge/publish; ненульовий exit → failed-run штатно.
 *
 * Зворотна сумісність: `node_executor` відсутній → поточний Claude-шлях без змін.
 *
 * --auto режим: сканує для готових задач (waiting + deps resolved), клеймить atomic mkdir.
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown, parseFrontMatter } from '../core/frontmatter.mjs'
import { nextRunNNN } from '../core/nnn.mjs'
import { loadConfig, resolveModelByTier, resolveMtDir, resolveWorktreesDir } from '../core/config.mjs'
import { scanTasks, topoSort, areDepsResolved } from '../core/scanner.mjs'
import { createWorktree, listActiveWorktrees, mergeWorktree, makeWorktreeName } from '../core/worktree.mjs'

/** Розділювач токенів у рядку команди `node_executor` (whitespace). */
const EXECUTOR_SPEC_SPLIT = /\s+/

/**
 * Пише run_NNN.md артефакт.
 * @param {string} taskDir директорія задачі
 * @param {string} nnn NNN рядок
 * @param {'success'|'failed'} result результат
 * @param {{ actor: string, startedAt: string, now: string }} meta метадані
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
function writeRunFile(taskDir, nnn, result, meta, writeFile) {
  const fm = {
    created_at: meta.now,
    started_at: meta.startedAt,
    actor: meta.actor,
    result
  }
  const content = buildMarkdown(fm, `## Run ${nnn}\n\nactor: ${meta.actor}\nresult: ${result}\n`)
  writeFile(join(taskDir, `run_${nnn}.md`), content, 'utf8')
}

/**
 * Читає model_tier із прапора `a.md` (секція "## Model tier") — джерело істини
 * виконавця після перенесення авторингу в Rust (`mt-scanner create`).
 * @param {string} taskDir директорія задачі
 * @param {(p: string, enc: string) => string} readFile читання файлу
 * @param {(p: string) => boolean} exists перевірка існування
 * @returns {string | null} tier (напр. "MAX") або null якщо немає a.md/секції
 */
function readModelTierFromFlag(taskDir, readFile, exists) {
  const flagPath = join(taskDir, 'a.md')
  if (!exists(flagPath)) return null
  let content
  try {
    content = readFile(flagPath, 'utf8')
  } catch {
    return null
  }
  const lines = content.split('\n')
  const idx = lines.findIndex(l => l.trim().toLowerCase() === '## model tier')
  if (idx === -1) return null
  for (let i = idx + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.startsWith('##')) break
    if (t) return t
  }
  return null
}

/**
 * Резолвить виконавця задачі: тип і модель. Істина model_tier — прапор `a.md`
 * (секція "## Model tier", авторинг mt-scanner). Fallback на `executor` у frontmatter
 * (старі вузли) → `default_model_tier` із `.mt.json`.
 * @param {string} taskDir директорія задачі
 * @param {Record<string, unknown>} fm frontmatter task.md
 * @param {object} config конфігурація
 * @param {{ readFile: (p: string, enc: string) => string, exists: (p: string) => boolean }} io ФС-ін'єкції
 * @returns {{ executorType: string, modelTier: string, model: string }} виконавець
 */
function resolveExecutor(taskDir, fm, config, io) {
  const executor = fm.executor && typeof fm.executor === 'object' ? fm.executor : {}
  const executorType = executor.type ?? 'agent'
  const tierFromFlag = readModelTierFromFlag(taskDir, io.readFile, io.exists)
  const modelTier = tierFromFlag ?? executor.model_tier ?? config.default_model_tier ?? 'AVG'
  return { executorType, modelTier, model: resolveModelByTier(config, modelTier) }
}

/**
 * Розбиває рядок команди `node_executor` на виконуваний файл і базові аргументи.
 * Проста whitespace-токенізація — очікуються прості команди без shell-метасимволів
 * (напр. `npx n-cursor mt-run-node`).
 * @param {string} spec рядок команди з `.mt.json`
 * @returns {{ cmd: string, args: string[] }} команда і базові аргументи
 */
function parseExecutorSpec(spec) {
  const parts = String(spec).trim().split(EXECUTOR_SPEC_SPLIT).filter(Boolean)
  return { cmd: parts[0], args: parts.slice(1) }
}

/**
 * Витягує shell-команди секції `## Check` із task.md — кожен непорожній рядок,
 * пропускаючи HTML-коментарі. Порожній масив, якщо секції немає.
 * @param {string} taskMd вміст task.md
 * @returns {string[]} команди для гейта done/audit
 */
function extractCheckCommands(taskMd) {
  const lines = taskMd.split('\n')
  const idx = lines.findIndex(l => l.trim().toLowerCase() === '## check')
  if (idx === -1) return []
  const cmds = []
  for (let i = idx + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.startsWith('## ')) break
    if (t && !t.startsWith('<!--')) cmds.push(t)
  }
  return cmds
}

/**
 * Ганяє команди `## Check` у worktree-директорії вузла; будь-який ненульовий
 * exit → провал гейта.
 * @param {string[]} cmds команди
 * @param {string} cwd директорія вузла у worktree
 * @param {(cmd: string, opts?: object) => string} execSyncFn виконавець
 * @param {(m: string) => void} log лог
 * @returns {boolean} true якщо всі команди пройшли (або їх немає)
 */
function runCheckGate(cmds, cwd, execSyncFn, log) {
  for (const cmd of cmds) {
    try {
      execSyncFn(cmd, { cwd, encoding: 'utf8' })
    } catch (error) {
      log(`run: ## Check не пройдено — "${cmd}" — ${error.message ?? String(error)}`)
      return false
    }
  }
  return true
}

/**
 * Інтерпретує результат spawnSync зовнішнього екзекутора: exit 0 = ok; парсить
 * останню непорожню лінію stdout як JSON `{ applied, touchedFiles }` (best-effort).
 * @param {{ status?: number|null, stdout?: string }} res результат spawnSync
 * @param {(m: string) => void} log лог
 * @returns {{ ok: boolean, code: number, applied: boolean, touchedFiles: string[] }} результат
 */
function interpretExecutorResult(res, log) {
  const ok = res?.status === 0
  let applied = false
  let touchedFiles = []
  if (ok && res.stdout) {
    const lastLine = String(res.stdout).trim().split('\n').findLast(Boolean) ?? '{}'
    try {
      const parsed = JSON.parse(lastLine)
      applied = Boolean(parsed.applied)
      touchedFiles = Array.isArray(parsed.touchedFiles) ? parsed.touchedFiles : []
    } catch {
      log('run: executor stdout не JSON — вважаю applied=false, touchedFiles=[]')
    }
  }
  return { ok, code: ok ? 0 : (res?.status ?? 1), applied, touchedFiles }
}

/**
 * Синтезує `fact_NNN.md` для успішного зовнішнього екзекутора (сам екзекутор
 * fact НЕ пише — «лише застосуй зміни»; контракт-артефакт лишається за MT).
 * @param {string} nnn NNN рядок
 * @param {{ applied: boolean, touchedFiles: string[] }} outcome результат екзекутора
 * @param {string} cmd команда екзекутора (для трасування)
 * @param {string} nowIso ISO-час
 * @returns {string} вміст fact_NNN.md
 */
function buildExecutorFact(nnn, outcome, cmd, nowIso) {
  const fm = { schema_version: 1, created_at: nowIso }
  const bullets = outcome.touchedFiles.map(f => `- ${f}`).join('\n')
  const touched = outcome.touchedFiles.length ? `\n\n## Touched\n${bullets}` : ''
  const summary =
    `## Summary\n\nВузол виконано зовнішнім екзекутором (\`${cmd}\`); ` +
    `applied=${outcome.applied}, файлів: ${outcome.touchedFiles.length}.`
  return buildMarkdown(fm, `${summary}${touched}\n`)
}

/**
 * Спавнить зовнішній екзекутор вузла замість Claude-шляху.
 * @param {string} nodeExecutor рядок команди з `.mt.json`
 * @param {string} worktreeTaskDir директорія вузла у worktree (= cwd + argv)
 * @param {Record<string, string>} env середовище (уже містить MT_*-змінні)
 * @param {number | undefined} timeoutMs hard-timeout
 * @param {(cmd: string, args: string[], opts?: object) => object} spawnSyncFn спавнер
 * @param {(m: string) => void} log лог
 * @returns {{ ok: boolean, code: number, applied: boolean, touchedFiles: string[] }} результат
 */
function spawnNodeExecutor(nodeExecutor, worktreeTaskDir, env, timeoutMs, spawnSyncFn, log) {
  const { cmd, args } = parseExecutorSpec(nodeExecutor)
  const res = spawnSyncFn(cmd, [...args, worktreeTaskDir], {
    cwd: worktreeTaskDir,
    env,
    encoding: 'utf8',
    timeout: timeoutMs
  })
  return interpretExecutorResult(res, log)
}

/**
 * Визначає результат зовнішнього екзекутора: ненульовий exit → `failed`;
 * інакше ганяє `## Check` (якщо є) і за успіху синтезує `fact_NNN.md`
 * (якщо екзекутор його ще не написав). MT володіє контракт-артефактом.
 * @param {{ ok: boolean, applied: boolean, touchedFiles: string[] }} outcome результат спавну
 * @param {{
 *   taskMd: string, nnn: string, factPath: string, worktreeTaskDir: string,
 *   nodeExecutor: string, now: string,
 *   exists: (p: string) => boolean,
 *   writeFile: (p: string, c: string, enc: string) => void,
 *   execSync: (cmd: string, opts?: object) => string,
 *   log: (m: string) => void
 * }} ctx контекст
 * @returns {'success'|'failed'} результат
 */
function resolveExecutorResult(outcome, ctx) {
  if (!outcome.ok) {
    ctx.log(`run: екзекутор завершився з ненульовим exit (${outcome.code})`)
    return 'failed'
  }
  const checks = extractCheckCommands(ctx.taskMd)
  if (!runCheckGate(checks, ctx.worktreeTaskDir, ctx.execSync, ctx.log)) {
    return 'failed'
  }
  if (!ctx.exists(ctx.factPath)) {
    ctx.writeFile(ctx.factPath, buildExecutorFact(ctx.nnn, outcome, ctx.nodeExecutor, ctx.now), 'utf8')
  }
  return 'success'
}

/**
 * Запускає одну задачу: creates worktree, spawns agent, writes run_NNN.md.
 * @param {string} taskPath відносний шлях задачі
 * @param {string} taskDir абсолютний шлях до директорії задачі
 * @param {object} config конфігурація
 * @param {string} root корінь репо
 * @param {{ actor?: string, dryRun?: boolean }} opts опції
 * @param {object} deps ін'єкції
 * @returns {{ ok: boolean, code: number }} результат
 */
function runTask(taskPath, taskDir, config, root, opts, deps) {
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))
  const spawnSyncFn = deps.spawnSync ?? spawnSync
  const nowFn = deps.now ?? (() => new Date().toISOString())
  const uuidFn = deps.uuid ?? randomUUID

  // 1. Читаємо task.md
  let taskMd
  try {
    taskMd = readFile(join(taskDir, 'task.md'), 'utf8')
  } catch (error) {
    log(`run: не вдалося прочитати task.md для "${taskPath}" — ${error.message ?? String(error)}`)
    return { ok: false, code: 1 }
  }
  const fm = parseFrontMatter(taskMd)

  const budgetSec = Number(fm.budget_sec) || config.default_budget_sec
  const budgetHardSec = Number(fm.budget_hard_sec) || budgetSec * config.budget_hard_sec_multiplier

  const { executorType, modelTier, model } = resolveExecutor(taskDir, fm, config, { readFile, exists })

  const actor = opts.actor ?? executorType
  // Точка розширення: зовнішній екзекутор замінює Claude-шлях лише для agent-actor.
  const nodeExecutor = config.node_executor || null
  const usedExecutor = Boolean(nodeExecutor) && (actor === 'agent' || actor === 'a')

  // 3. Обчислюємо NNN
  const nnn = nextRunNNN(taskDir, readdir)

  // 4. Створюємо worktree (atomic mkdir lock)
  const worktreesDir = resolveWorktreesDir(config, root)
  const worktreeName = makeWorktreeName(taskPath)
  const worktreePath = join(worktreesDir, worktreeName)
  const worktreeTaskDir = join(worktreePath, relative(root, taskDir))

  log(`run: запускаємо задачу "${taskPath}" (NNN=${nnn}, actor=${actor})`)

  if (opts.dryRun) {
    log(`run: --dry-run — пропускаємо фактичний запуск`)
    return { ok: true, code: 0 }
  }

  let createResult
  try {
    createResult = createWorktree(worktreesDir, worktreeName, root, { execSync: execSyncFn })
  } catch (error) {
    log(`run: не вдалося створити worktree — ${error.message ?? String(error)}`)
    return { ok: false, code: 1 }
  }

  if (!createResult) {
    log(`run: задача "${taskPath}" вже запущена (worktree існує) — пропускаємо`)
    return { ok: false, code: 2 }
  }

  // 5. ENV
  const startedAt = nowFn()
  const runToken = uuidFn()
  const env = {
    ...process.env,
    MT_RUN_NNN: nnn,
    MT_BUDGET_SEC: String(budgetSec),
    MT_HARD_BUDGET_SEC: String(budgetHardSec),
    MT_STARTED_AT: startedAt,
    MT_TASK_PATH: taskPath,
    MT_NODE_DIR: worktreeTaskDir,
    MT_WORKTREE: worktreePath,
    MT_RUN_TOKEN: runToken,
    MT_MODEL_TIER: modelTier
  }

  // 6. Спавнимо subprocess (spawnSync — синхронно)
  const timeoutMs = budgetHardSec > 0 ? budgetHardSec * 1000 : undefined

  let executorOutcome = null

  if (usedExecutor) {
    // Зовнішній екзекутор виконує вузол замість Claude-шляху.
    log(`run: делегуємо вузол зовнішньому екзекутору "${nodeExecutor}"`)
    executorOutcome = spawnNodeExecutor(nodeExecutor, worktreeTaskDir, env, timeoutMs, spawnSyncFn, log)
  } else if (actor === 'agent' || actor === 'a') {
    // Запускаємо claude CLI у worktree
    const claudeArgs = [
      '--model',
      model,
      '--no-session',
      '-p',
      `You are executing task: ${taskPath}\nWorking directory: ${worktreeTaskDir}\nRun NNN: ${nnn}\nBudget: ${budgetSec}s\n\nRead task.md and plan_*.md, execute the task, write fact_${nnn}.md with results.`
    ]
    spawnSyncFn('claude', claudeArgs, {
      cwd: worktreeTaskDir,
      env,
      encoding: 'utf8',
      timeout: timeoutMs
    })
  } else if (actor === 'human') {
    // Людина виконує вручну — чекаємо на fact файл
    log(`run: задача "${taskPath}" очікує ручного виконання`)
    log(`     worktree: ${worktreePath}`)
    log(`     MT_RUN_NNN=${nnn}`)
    log(`     після виконання запустіть: mt done ${taskPath}`)
    // Не чекаємо — повертаємо success без run_NNN.md
    return { ok: true, code: 0 }
  } else {
    log(`run: невідомий actor "${actor}" — підтримується: agent, human`)
    return { ok: false, code: 1 }
  }

  // 8. Після exit: визначаємо результат
  const factPath = join(worktreeTaskDir, `fact_${nnn}.md`)

  let result
  if (usedExecutor) {
    result = resolveExecutorResult(executorOutcome, {
      taskMd,
      nnn,
      factPath,
      worktreeTaskDir,
      nodeExecutor,
      now: nowFn(),
      exists,
      writeFile,
      execSync: execSyncFn,
      log
    })
  } else {
    // Claude-шлях: fact у worktree-директорії вузла = success.
    result = exists(factPath) ? 'success' : 'failed'
  }

  // 9. Success artifacts мають пройти через git merge; failed run фіксуємо
  // у main checkout, бо діагностичний worktree навмисно лишається незмердженим.
  const runArtifactDir = result === 'success' ? worktreeTaskDir : taskDir
  try {
    writeRunFile(
      runArtifactDir,
      nnn,
      result,
      {
        actor,
        startedAt,
        now: nowFn()
      },
      writeFile
    )
    log(`run: записано run_${nnn}.md (result: ${result})`)
  } catch (error) {
    log(`run: не вдалося записати run_${nnn}.md — ${error.message ?? String(error)}`)
  }

  // 10. Якщо success: merge worktree
  if (result === 'success') {
    const mergeResult = mergeWorktree(worktreePath, root, { execSync: execSyncFn })
    if (mergeResult.ok) {
      log(`run: worktree merged і видалено`)
    } else {
      log(`run: merge worktree не вдався — ${mergeResult.error}`)
    }
    return { ok: true, code: 0 }
  }
  log(`run: задача "${taskPath}" завершилась з помилкою`)
  log(`run: worktree збережено для діагностики: ${worktreePath}`)
  return { ok: false, code: 1 }
}

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
 * `--auto`: знаходить ready-задачі (waiting + deps resolved) і запускає кожну.
 * @param {{ mtDir: string, activeWorktrees: Map<string, object>, config: object, root: string, actor: string | null }} ctx контекст прогону
 * @param {{ log: (m: string) => void, readFile: (p: string, enc: string) => string, readdir: (d: string) => string[], exists: (p: string) => boolean }} io файлові/лог ін'єкції
 * @param {object} taskDeps ін'єкції, що прокидаються у runTask
 * @returns {number} exit code
 */
function runAutoMode(ctx, io, taskDeps) {
  const allNodes = scanTasks(ctx.mtDir, ctx.activeWorktrees, {
    readdirSync: io.readdir,
    existsSync: io.exists,
    readFileSync: io.readFile
  })
  const nodeMap = new Map(allNodes.map(n => [n.id, n]))
  const readyNodes = topoSort(allNodes).filter(n => n.state === 'waiting' && areDepsResolved(n, nodeMap))

  if (readyNodes.length === 0) {
    io.log('run --auto: немає готових задач для запуску')
    return 0
  }

  io.log(`run --auto: знайдено ${readyNodes.length} готових задач`)
  let anyFailed = false

  for (const node of readyNodes) {
    const result = runTask(node.path, node.dir, ctx.config, ctx.root, { actor: ctx.actor ?? undefined }, taskDeps)
    if (!result.ok && result.code !== 2) anyFailed = true
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
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string,
 *   spawnSync?: (cmd: string, args: string[], opts?: object) => object,
 *   statSync?: (p: string) => object,
 *   now?: () => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function run(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync

  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))

  const { taskPath, actor, autoMode } = parseRunArgs(args)

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)

  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })

  // Перевіряємо ліміт worktrees
  if (activeWorktrees.size >= config.max_worktrees) {
    log(`run: досягнуто max_worktrees (${config.max_worktrees}) — зачекайте завершення поточних задач`)
    return 1
  }

  if (activeWorktrees.size >= config.warn_worktrees_above) {
    log(`run: увага — ${activeWorktrees.size} активних worktrees (попередження при >${config.warn_worktrees_above})`)
  }

  if (autoMode) {
    return runAutoMode(
      { mtDir, activeWorktrees, config, root, actor },
      { log, readFile, readdir, exists },
      { ...deps, log, execSync: execSyncFn }
    )
  }

  // Запускаємо конкретну задачу
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

  // Перевіряємо deps
  const allNodes = scanTasks(mtDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })
  const nodeMap = new Map(allNodes.map(n => [n.id, n]))
  const targetNode = nodeMap.get(taskPath)

  if (targetNode && !areDepsResolved(targetNode, nodeMap)) {
    const unresolvedDeps = targetNode.deps.filter(dep => nodeMap.get(dep)?.state !== 'resolved')
    log(`run: задача "${taskPath}" має невирішені залежності: ${unresolvedDeps.join(', ')}`)
    return 1
  }

  const result = runTask(
    taskPath,
    taskDir,
    config,
    root,
    { actor: actor ?? undefined },
    {
      ...deps,
      log,
      execSync: execSyncFn
    }
  )

  return result.code
}
