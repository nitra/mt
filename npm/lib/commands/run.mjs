/**
 * `mt run [<path>] [--actor a] [--auto]` — запуск задачі(задач).
 *
 * Wrapper логіка:
 * 1. Читає task.md → budget_sec, budget_hard_sec, deps, mode, executor
 * 2. Перевіряє що всі deps resolved
 * 3. Обчислює NNN = count(run_*.md) + 1; MT_ATTEMPT = NNN - NNN(останнього fact) (мін. 1) —
 *    формула "failed_streak + 1" (graph.md); драбину (`## Retry ladder` у `a.md`, або дефолт
 *    base/diagnose-first/alternative-approach) резолвить у стратегію + ескалацію model_tier
 * 4. git worktree add .worktrees/<task-epoch>/ (atomic mkdir lock — EEXIST = skip)
 * 5. ENV: MT_RUN_NNN, MT_ATTEMPT, MT_RETRY_STRATEGY, MT_BUDGET_SEC, MT_HARD_BUDGET_SEC,
 *    MT_STARTED_AT, MT_TASK_PATH, MT_NODE_DIR, MT_WORKTREE, MT_RUN_TOKEN, MT_MODEL_TIER,
 *    MT_AGENT_CLI
 * 6. Спавнить subprocess: підписочний CLI-виконавець (agent_cli, див. нижче)
 * 7. Після exit: fact_NNN.md є І `## Check` пройдено → result:success; else → failed
 * 8. Пише run_NNN.md
 * 9. Якщо success: git merge + delete worktree
 *
 * ## Підписочні CLI-виконавці (`agent_cli`)
 *
 * Вбудований agent-шлях — headless-запуск одного з підписочних CLI (runtime.md
 * «Підписочні CLI-виконавці»): `claude` | `codex` | `cursor` | `pi` (локальні
 * omlx-моделі через pi.dev CLI). Користувач авторизується у CLI локально під
 * ВЛАСНОЮ підпискою — MT не тримає ключів і не білінгує токени.
 *
 * Конфігурація виконавців — **user-level, з ENV** (`.mt.json` — лише
 * repo-scoped): `MT_AGENT_CLI` (дефолтний CLI), `MT_CLOUD_AGENT_CLIS`
 * (каскад, comma-separated), `MT_AGENT_CLI_MODEL_MAP` (JSON «CLI → тир →
 * модель»). Per-node override CLI — секція `## Agent cli` в `a.md`
 * (крос-програмковий вимір vision.md). Модель тиру MIN/AVG/MAX резолвиться
 * мапою; CLI без мапінгу резолвить модель сам — тир іде hint-ом
 * env `MT_MODEL_TIER`.
 *
 * ## Каскад хмарних підписок (`MT_CLOUD_AGENT_CLIS`)
 *
 * Упорядкований список хмарних CLI користувача (напр. "codex,cursor").
 * Якщо запуск CLI падає з ознаками вичерпаних лімітів підписки
 * (rate limit / quota / 429), runner автоматично пробує наступний CLI
 * каскаду — [обраний agent_cli, ...каскад] без дублів — поки не спрацює або
 * не вичерпаються всі. Фактичний CLI фіксується у frontmatter run_NNN.md
 * (`agent_cli`).
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
import { latestFactNNN, nextRunNNN } from '../core/nnn.mjs'
import {
  loadAgentCliEnv,
  loadConfig,
  normalizeModelTier,
  resolveModelForCli,
  resolveMtDir,
  resolveWorktreesDir
} from '../core/config.mjs'
import { scanTasks, topoSort, areDepsResolved } from '../core/scanner.mjs'
import { createWorktree, listActiveWorktrees, mergeWorktree, makeWorktreeName } from '../core/worktree.mjs'

/** Маркер буліта (`-`/`*`) на початку рядка щабля `## Retry ladder` у `a.md`. */
const LADDER_BULLET_RE = /^[-*]\s*/

/** Порядок model_tier для ескалації драбиною (позиційний зсув: MIN→AVG→MAX, cap на MAX). */
const MODEL_TIER_ORDER = ['MIN', 'AVG', 'MAX']

/**
 * Драбина ретраїв за замовчуванням (graph.md "Retry ladder"): 1 — base;
 * 2 — diagnose-first; 3 — alternative-approach (+1 model_tier). Коротша
 * драбина (`retry_ladder`-override у `a.md`) — останній щабель повторюється.
 */
const DEFAULT_RETRY_LADDER = [
  { strategy: 'base', model_tier_delta: 0 },
  { strategy: 'diagnose-first', model_tier_delta: 0 },
  { strategy: 'alternative-approach', model_tier_delta: 1 }
]

/**
 * Підписочні CLI-виконавці вбудованого agent-шляху (runtime.md «Підписочні
 * CLI-виконавці»). Кожен CLI користувач авторизує локально під власною
 * підпискою; MT не тримає ключів. Тир-алгоритм MIN/AVG/MAX резолвить
 * КОНКРЕТНУ модель per-CLI через env `MT_AGENT_CLI_MODEL_MAP` (напр. codex:
 * MIN→luna, AVG→terra, MAX→sola) — `resolveModelForCli`; без мапи модель
 * `null` → прапор моделі не передається, CLI вирішує сам (тир лишається
 * hint-ом env `MT_MODEL_TIER`).
 */
const AGENT_CLIS = {
  claude: {
    cmd: 'claude',
    /**
     * @param {{ model: string | null, prompt: string }} p параметри запуску
     * @returns {string[]} argv
     */
    buildArgs: p => [...(p.model ? ['--model', p.model] : []), '--no-session', '-p', p.prompt]
  },
  codex: {
    cmd: 'codex',
    /**
     * @param {{ model: string | null, prompt: string }} p параметри запуску
     * @returns {string[]} argv
     */
    buildArgs: p => ['exec', ...(p.model ? ['-m', p.model] : []), '--full-auto', p.prompt]
  },
  cursor: {
    cmd: 'cursor-agent',
    /**
     * @param {{ model: string | null, prompt: string }} p параметри запуску
     * @returns {string[]} argv
     */
    buildArgs: p => [...(p.model ? ['--model', p.model] : []), '--print', '--force', p.prompt]
  },
  pi: {
    cmd: 'pi',
    /**
     * @param {{ model: string | null, prompt: string }} p параметри запуску
     * @returns {string[]} argv
     */
    buildArgs: p => [...(p.model ? ['--model', p.model] : []), '-p', p.prompt]
  }
}

/** Ознаки вичерпаних лімітів підписки у виводі CLI (каскад MT_CLOUD_AGENT_CLIS). */
const RATE_LIMIT_RE = /rate.?limit|too many requests|usage limit|quota (exceeded|reached)|\b429\b/i

/**
 * Чи схожий результат spawnSync на вичерпані ліміти підписки: ненульовий exit
 * і rate-limit-маркер у stdout/stderr. Best-effort евристика по тексту виводу.
 * @param {{ status?: number | null, stdout?: string, stderr?: string } | null | undefined} res результат spawnSync
 * @returns {boolean} true якщо ліміти вичерпані
 */
function isRateLimited(res) {
  if (!res || res.status === 0) return false
  return RATE_LIMIT_RE.test(`${res.stdout ?? ''}\n${res.stderr ?? ''}`)
}

/**
 * Headless-запуск підписочного CLI з каскадом по хмарних провайдерах
 * (env `MT_CLOUD_AGENT_CLIS`): порядок — [обраний agent_cli, ...каскад] без
 * дублів; rate-limited результат → лог і наступний кандидат; невідомі імена
 * пропускаються. Модель тиру резолвиться per-кандидат (`MT_AGENT_CLI_MODEL_MAP`).
 * @param {{
 *   agentCli: string, cliEnv: object, modelTier: string,
 *   prompt: string, cwd: string, env: Record<string, string>,
 *   timeoutMs: number | undefined,
 *   spawnSync: (cmd: string, args: string[], opts?: object) => object,
 *   log: (m: string) => void
 * }} p параметри
 * @returns {string | null} імʼя CLI, що виконав run, або null (усі вичерпані)
 */
function spawnAgentCliCascade(p) {
  const cascade = [p.agentCli, ...p.cliEnv.cloudAgentClis].filter((c, i, arr) => arr.indexOf(c) === i)
  for (const cliName of cascade) {
    const cli = AGENT_CLIS[cliName]
    if (!cli) {
      p.log(`run: пропускаю невідомий CLI "${cliName}" у каскаді MT_CLOUD_AGENT_CLIS`)
      continue
    }
    const model = resolveModelForCli(p.cliEnv, cliName, p.modelTier)
    const res = p.spawnSync(cli.cmd, cli.buildArgs({ model, prompt: p.prompt }), {
      cwd: p.cwd,
      env: { ...p.env, MT_AGENT_CLI: cliName },
      encoding: 'utf8',
      timeout: p.timeoutMs
    })
    if (!isRateLimited(res)) return cliName
    p.log(`run: "${cliName}" — вичерпано ліміти підписки, каскад на наступний хмарний CLI`)
  }
  p.log('run: усі CLI каскаду вичерпали ліміти підписки')
  return null
}

/**
 * Будує headless-промпт agent-шляху — спільний для всіх підписочних CLI.
 * @param {{ taskPath: string, worktreeTaskDir: string, nnn: string, budgetSec: number }} p параметри
 * @returns {string} промпт
 */
function buildAgentPrompt(p) {
  return (
    `You are executing task: ${p.taskPath}\nWorking directory: ${p.worktreeTaskDir}\n` +
    `Run NNN: ${p.nnn}\nBudget: ${p.budgetSec}s\n\n` +
    `Read task.md and plan_*.md, execute the task, write fact_${p.nnn}.md with results.`
  )
}

/**
 * Пише run_NNN.md артефакт. `meta.agentCli` (фактичний CLI після каскаду
 * cloud_agent_clis) потрапляє у frontmatter як `agent_cli`.
 * @param {string} taskDir директорія задачі
 * @param {string} nnn NNN рядок
 * @param {'success'|'failed'} result результат
 * @param {{ actor: string, startedAt: string, now: string, agentCli?: string | null }} meta метадані
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
function writeRunFile(taskDir, nnn, result, meta, writeFile) {
  const fm = {
    created_at: meta.now,
    started_at: meta.startedAt,
    actor: meta.actor,
    ...(meta.agentCli && { agent_cli: meta.agentCli }),
    result
  }
  const content = buildMarkdown(fm, `## Run ${nnn}\n\nactor: ${meta.actor}\nresult: ${result}\n`)
  writeFile(join(taskDir, `run_${nnn}.md`), content, 'utf8')
}

/**
 * Читає непорожні рядки секції `## <title>` прапора `a.md` — спільний
 * markdown-конвент прапорів виконавця («## Model tier», «## Retry ladder»,
 * «## Agent cli»; авторинг mt-scanner). Немає a.md/секції/рядків → null.
 * @param {string} taskDir директорія задачі
 * @param {string} title заголовок секції у lower-case (напр. "## model tier")
 * @param {(p: string, enc: string) => string} readFile читання файлу
 * @param {(p: string) => boolean} exists перевірка існування
 * @returns {string[] | null} trim-нуті рядки секції або null
 */
function readFlagSection(taskDir, title, readFile, exists) {
  const flagPath = join(taskDir, 'a.md')
  if (!exists(flagPath)) return null
  let content
  try {
    content = readFile(flagPath, 'utf8')
  } catch {
    return null
  }
  const lines = content.split('\n')
  const idx = lines.findIndex(l => l.trim().toLowerCase() === title)
  if (idx === -1) return null
  const values = []
  for (let i = idx + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t.startsWith('##')) break
    if (t) values.push(t)
  }
  return values.length ? values : null
}

/**
 * Парсить рядки секції "## Retry ladder" у драбину (один рядок/буліт на щабель).
 * Щабель "alternative-approach" завжди несе `model_tier_delta: 1` (graph.md);
 * решта назв — 0 (сигнал стратегії без ескалації тиру).
 * @param {string[]} lines рядки секції
 * @returns {{ strategy: string, model_tier_delta: number }[] | null} драбина або null
 */
function parseRetryLadder(lines) {
  const steps = lines
    .map(l => l.replace(LADDER_BULLET_RE, '').trim().toLowerCase())
    .filter(Boolean)
    .map(strategy => ({ strategy, model_tier_delta: strategy === 'alternative-approach' ? 1 : 0 }))
  return steps.length ? steps : null
}

/**
 * Обчислює номер спроби: `MT_ATTEMPT = failed_streak + 1` (graph.md) — різниця
 * між NNN наступного run і NNN останнього прийнятого fact (0, якщо fact ще
 * немає), мінімум 1. Еквівалент count(execution-failure run після fact) + 1,
 * бо у поточному (JS) шляху кожен run без fact — виконавча невдача.
 * @param {string} nnn NNN наступного run (`nextRunNNN`)
 * @param {string | null} lastFactNNN NNN останнього fact або null
 * @returns {number} номер спроби (мінімум 1)
 */
function computeAttempt(nnn, lastFactNNN) {
  return Math.max(1, Number(nnn) - Number(lastFactNNN ?? 0))
}

/**
 * Резолвить щабель драбини для номера спроби; коротша драбина — останній
 * щабель повторюється (graph.md: "Коротша драбина → останній щабель повторюється").
 * @param {number} attempt номер спроби (1-based)
 * @param {{ strategy: string, model_tier_delta: number }[]} ladder драбина
 * @returns {{ strategy: string, model_tier_delta: number }} щабель
 */
function resolveRetryStep(attempt, ladder) {
  return ladder[Math.min(Math.max(attempt - 1, 0), ladder.length - 1)]
}

/**
 * Підвищує model_tier на `delta` позицій драбиною MIN→AVG→MAX (cap на MAX).
 * Невідомий tier або delta=0 → без змін.
 * @param {string} tier поточний tier
 * @param {number} delta кількість позицій підвищення
 * @returns {string} ефективний tier
 */
function bumpModelTier(tier, delta) {
  if (!delta) return tier
  const idx = MODEL_TIER_ORDER.indexOf(tier)
  if (idx === -1) return tier
  return MODEL_TIER_ORDER[Math.min(idx + delta, MODEL_TIER_ORDER.length - 1)]
}

/**
 * Резолвить виконавця задачі: тип, модель і підписочний CLI. Істина model_tier —
 * прапор `a.md` (секція "## Model tier", авторинг mt-scanner). Fallback на `executor`
 * у frontmatter (старі вузли) → `default_model_tier` із `.mt.json`. На attempt 2+
 * (retry ladder) ескалює ефективний model_tier за щаблем драбини (`## Retry ladder`
 * override у `a.md`, або дефолт) і повертає стратегію щабля для `MT_RETRY_STRATEGY`.
 * Підписочний CLI: `a.md` "## Agent cli" (per-node) → `.mt.json` `agent_cli` → claude.
 * Модель тут не резолвиться — вона per-кандидат каскаду (`spawnAgentCliCascade`).
 * @param {string} taskDir директорія задачі
 * @param {Record<string, unknown>} fm frontmatter task.md
 * @param {object} config конфігурація
 * @param {{ readFile: (p: string, enc: string) => string, exists: (p: string) => boolean }} io ФС-ін'єкції
 * @param {number} attempt номер спроби (MT_ATTEMPT)
 * @param {object} cliEnv конфіг виконавців з ENV (`loadAgentCliEnv`)
 * @returns {{ executorType: string, modelTier: string, retryStrategy: string, agentCli: string }} виконавець
 */
function resolveExecutor(taskDir, fm, config, io, attempt, cliEnv) {
  const executor = fm.executor && typeof fm.executor === 'object' ? fm.executor : {}
  const executorType = executor.type ?? 'agent'
  const tierFromFlag = readFlagSection(taskDir, '## model tier', io.readFile, io.exists)?.[0] ?? null
  const baseModelTier = normalizeModelTier(tierFromFlag ?? executor.model_tier ?? config.default_model_tier ?? 'AVG')
  const ladderLines = readFlagSection(taskDir, '## retry ladder', io.readFile, io.exists)
  const ladder = (ladderLines && parseRetryLadder(ladderLines)) ?? DEFAULT_RETRY_LADDER
  const step = resolveRetryStep(attempt, ladder)
  const modelTier = bumpModelTier(baseModelTier, step.model_tier_delta)
  const cliFromFlag = readFlagSection(taskDir, '## agent cli', io.readFile, io.exists)?.[0]
  const agentCli = (cliFromFlag ?? cliEnv.agentCli).toLowerCase()
  return { executorType, modelTier, retryStrategy: step.strategy, agentCli }
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
 * Визначає результат run-у після виходу виконавця — `## Check`-гейт:
 * агент сам пише fact; success = fact існує І Check пройдено.
 * @param {{
 *   taskMd: string, factPath: string, worktreeTaskDir: string,
 *   exists: (p: string) => boolean,
 *   execSync: (cmd: string, opts?: object) => string,
 *   log: (m: string) => void
 * }} ctx контекст
 * @returns {'success'|'failed'} результат
 */
function resolveRunResult(ctx) {
  const checksPass = runCheckGate(extractCheckCommands(ctx.taskMd), ctx.worktreeTaskDir, ctx.execSync, ctx.log)
  return ctx.exists(ctx.factPath) && checksPass ? 'success' : 'failed'
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
  // Конфіг виконавців — user-level ENV (спільний для всіх репозиторіїв).
  const baseEnv = deps.env ?? process.env
  const cliEnv = loadAgentCliEnv(baseEnv)

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

  // 3. Обчислюємо NNN і номер спроби (MT_ATTEMPT = failed_streak + 1, graph.md)
  const nnn = nextRunNNN(taskDir, readdir)
  const lastFactNNN = latestFactNNN(taskDir, readdir)
  const attempt = computeAttempt(nnn, lastFactNNN)

  const { executorType, modelTier, retryStrategy, agentCli } = resolveExecutor(
    taskDir,
    fm,
    config,
    { readFile, exists },
    attempt,
    cliEnv
  )

  const actor = opts.actor ?? executorType
  const isAgentActor = actor === 'agent' || actor === 'a'

  // Валідація підписочного CLI до створення worktree (fail-fast).
  if (isAgentActor && !AGENT_CLIS[agentCli]) {
    log(`run: невідомий agent_cli "${agentCli}" — підтримується: ${Object.keys(AGENT_CLIS).join(', ')}`)
    return { ok: false, code: 1 }
  }

  // 4. Створюємо worktree (atomic mkdir lock)
  const worktreesDir = resolveWorktreesDir(config, root)
  const worktreeName = makeWorktreeName(taskPath)
  const worktreePath = join(worktreesDir, worktreeName)
  const worktreeTaskDir = join(worktreePath, relative(root, taskDir))

  log(`run: запускаємо задачу "${taskPath}" (NNN=${nnn}, actor=${actor}, attempt=${attempt}/${retryStrategy})`)

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

  if (!isAgentActor) {
    if (actor === 'human') {
      // Людина виконує вручну — чекаємо на fact файл
      log(`run: задача "${taskPath}" очікує ручного виконання`)
      log(`     worktree: ${worktreePath}`)
      log(`     MT_RUN_NNN=${nnn}`)
      log(`     після виконання запустіть: mt done ${taskPath}`)
      // Не чекаємо — повертаємо success без run_NNN.md
      return { ok: true, code: 0 }
    }
    log(`run: невідомий actor "${actor}" — підтримується: agent, human`)
    return { ok: false, code: 1 }
  }

  // 5. ENV
  const startedAt = nowFn()
  const runToken = uuidFn()
  const env = {
    ...baseEnv,
    MT_RUN_NNN: nnn,
    MT_ATTEMPT: String(attempt),
    MT_RETRY_STRATEGY: retryStrategy,
    MT_BUDGET_SEC: String(budgetSec),
    MT_HARD_BUDGET_SEC: String(budgetHardSec),
    MT_STARTED_AT: startedAt,
    MT_TASK_PATH: taskPath,
    MT_NODE_DIR: worktreeTaskDir,
    MT_WORKTREE: worktreePath,
    MT_RUN_TOKEN: runToken,
    MT_MODEL_TIER: modelTier,
    MT_AGENT_CLI: agentCli
  }

  // 6. Спавнимо subprocess (spawnSync — синхронно)
  const timeoutMs = budgetHardSec > 0 ? budgetHardSec * 1000 : undefined

  // Headless-запуск підписочного CLI у worktree (auth — локальна підписка
  // користувача) з каскадом по хмарних провайдерах за rate-limit.
  const usedAgentCli = spawnAgentCliCascade({
    agentCli,
    cliEnv,
    modelTier,
    prompt: buildAgentPrompt({ taskPath, worktreeTaskDir, nnn, budgetSec }),
    cwd: worktreeTaskDir,
    env,
    timeoutMs,
    spawnSync: spawnSyncFn,
    log
  })

  // 8. Після exit: визначаємо результат (## Check-гейт)
  const factPath = join(worktreeTaskDir, `fact_${nnn}.md`)

  const result = resolveRunResult({
    taskMd,
    factPath,
    worktreeTaskDir,
    exists,
    execSync: execSyncFn,
    log
  })

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
        now: nowFn(),
        agentCli: usedAgentCli
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
