/**
 * `mt run [<path>] [--actor a] [--auto]` — запуск задачі(задач).
 *
 * Wrapper логіка:
 * 1. Читає task.md → budget_sec, budget_hard_sec, deps, mode, executor
 * 2. Перевіряє що всі deps resolved
 * 3. Обчислює NNN = count(run_*.md) + 1
 * 4. git worktree add .worktrees/<task-epoch>/ (atomic mkdir lock — EEXIST = skip)
 * 5. ENV: MT_RUN_NNN, MT_BUDGET_SEC, MT_HARD_BUDGET_SEC, MT_STARTED_AT, MT_TASK_PATH
 * 6. Спавнить subprocess (claude або mt run --actor auditor)
 * 7. Після exit: fact_NNN.md є → result:success; else → result:failed
 * 8. Пише run_NNN.md
 * 9. Якщо success: git merge + delete worktree
 *
 * --auto режим: сканує для готових задач (waiting + deps resolved), клеймить atomic mkdir.
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { buildMarkdown, parseFrontMatter } from '../core/frontmatter.mjs'
import { nextRunNNN } from '../core/nnn.mjs'
import { loadConfig, resolveModelByTier, resolveMtDir, resolveWorktreesDir } from '../core/config.mjs'
import { scanTasks, topoSort, areDepsResolved } from '../core/scanner.mjs'
import { createWorktree, listActiveWorktrees, mergeWorktree, makeWorktreeName } from '../core/worktree.mjs'

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
  // eslint-disable-next-line sonarjs/os-command
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))
  const spawnSyncFn = deps.spawnSync ?? spawnSync
  const nowFn = deps.now ?? (() => new Date().toISOString())

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

  const executor = fm.executor && typeof fm.executor === 'object' ? fm.executor : {}
  const executorType = executor.type ?? 'agent'
  const modelTier = executor.model_tier ?? 'AVG'
  const model = resolveModelByTier(config, modelTier)

  const actor = opts.actor ?? executorType

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
  const env = {
    ...process.env,
    MT_RUN_NNN: nnn,
    MT_BUDGET_SEC: String(budgetSec),
    MT_HARD_BUDGET_SEC: String(budgetHardSec),
    MT_STARTED_AT: startedAt,
    MT_TASK_PATH: taskPath
  }

  // 6. Спавнимо subprocess (spawnSync — синхронно)
  const timeoutMs = budgetHardSec > 0 ? budgetHardSec * 1000 : undefined

  if (actor === 'agent' || actor === 'a') {
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

  // 8. Після exit: перевіряємо fact_NNN.md
  const factPath = join(worktreeTaskDir, `fact_${nnn}.md`)

  // Перевіряємо fact у task directory всередині worktree.
  const hasFactInWorktree = exists(factPath)
  const result = hasFactInWorktree ? 'success' : 'failed'

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
  // eslint-disable-next-line sonarjs/os-command
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))

  // Парсимо аргументи
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
    // Знаходимо всі ready задачі і запускаємо їх
    const allNodes = scanTasks(mtDir, activeWorktrees, {
      readdirSync: readdir,
      existsSync: exists,
      readFileSync: readFile
    })
    const nodeMap = new Map(allNodes.map(n => [n.id, n]))
    const readyNodes = topoSort(allNodes).filter(n => n.state === 'waiting' && areDepsResolved(n, nodeMap))

    if (readyNodes.length === 0) {
      log('run --auto: немає готових задач для запуску')
      return 0
    }

    log(`run --auto: знайдено ${readyNodes.length} готових задач`)
    let anyFailed = false

    for (const node of readyNodes) {
      const result = runTask(
        node.path,
        node.dir,
        config,
        root,
        { actor: actor ?? undefined },
        {
          ...deps,
          log,
          execSync: execSyncFn
        }
      )
      if (!result.ok && result.code !== 2) anyFailed = true
    }

    return anyFailed ? 1 : 0
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
