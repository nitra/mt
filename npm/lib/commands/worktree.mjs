/**
 * `mt worktree create|remove|list|prune|inventory` — developer git-worktree lifecycle.
 *
 * Конвенція (правильно та ефективно): checkout у `<worktrees_dir>/<sanitize_branch(branch)>/`,
 * інвентар — окремо в `<worktrees_dir>/.meta/<sanitized>.md`, тож `<worktrees_dir>/` містить
 * лише worktree-каталоги (+ `.meta/`). Worktree **ефемерний**: `remove` прибирає і checkout,
 * і git-гілку. sanitizeBranch — синхронізовано з Rust `sanitize_branch` у scanner/src/lib.rs.
 * @typedef {object} WorktreeCtx
 * @property {string} root корінь репо
 * @property {string} worktreesDir абсолютний шлях до worktrees_dir
 * @property {(s: string) => void} log логер
 * @property {(cmd: string, opts?: object) => string} execSyncFn git-виклик
 * @property {(p: string) => boolean} exists перевірка існування шляху
 * @property {(p: string, c: string) => void} writeFile запис файлу
 * @property {(p: string, enc?: string) => string} readFile читання файлу
 * @property {(d: string) => string[]} readdir лістинг каталогу
 * @property {(p: string) => void} rmFile видалення
 * @property {(p: string, o?: object) => void} mkdirFn mkdir
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveWorktreesDir } from '../core/config.mjs'

/** Підкаталог інвентарів усередині worktrees_dir (відокремлений від checkout-каталогів). */
const META_DIR = '.meta'
/** Поріг переліку файлів у dirty-notice: понад нього — лише кількість. */
const DIRTY_LIST_LIMIT = 10
/** Стеля спроб підбору вільної назви гілки (захист від нескінченного циклу). */
const FIRST_FREE_LIMIT = 1000

/**
 * Імʼя git-гілки → безпечне пласке імʼя каталогу. ⚠️ Sync з Rust `sanitize_branch`.
 * @param {string} branch імʼя гілки
 * @returns {string} sanitized імʼя (небезпечні символи → `-`, краєві `-` обрізані)
 */
function sanitizeBranch(branch) {
  let result = ''
  let prevDash = false
  for (const ch of branch) {
    const isAllow =
      (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') || ch === '_' || ch === '-'
    const out = isAllow ? ch : '-'
    if (out === '-') {
      if (!prevDash) result += '-'
      prevDash = true
    } else {
      result += out
      prevDash = false
    }
  }
  let start = 0
  let end = result.length
  while (start < end && result[start] === '-') start++
  while (end > start && result[end - 1] === '-') end--
  return result.slice(start, end)
}

/**
 * Шлях до підкаталогу інвентарів.
 * @param {string} worktreesDir абсолютний worktrees_dir
 * @returns {string} `<worktreesDir>/.meta`
 */
function metaDirPath(worktreesDir) {
  return join(worktreesDir, META_DIR)
}

/**
 * Шлях до інвентарного `.md` для sanitized-назви.
 * @param {string} worktreesDir абсолютний worktrees_dir
 * @param {string} sanitized sanitized імʼя гілки
 * @returns {string} `<worktreesDir>/.meta/<sanitized>.md`
 */
function inventoryPath(worktreesDir, sanitized) {
  return join(metaDirPath(worktreesDir), `${sanitized}.md`)
}

/**
 * Текст інвентарного файлу.
 * @param {string} branch імʼя гілки
 * @param {string} description опис задачі
 * @returns {string} markdown-вміст
 */
function inventoryContent(branch, description) {
  const date = new Date().toISOString().slice(0, 10)
  return `# ${branch}\n\n${description}\n\nCreated: ${date}\n`
}

/**
 * Абсолютні шляхи з `git worktree list --porcelain`.
 * @param {string} out вивід git
 * @returns {string[]} шляхи checkout
 */
function parseWorktreeList(out) {
  const paths = []
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) paths.push(line.slice('worktree '.length).trim())
  }
  return paths
}

/**
 * Перша вільна назва гілки: `base`, `base2`, `base3`… (суфікс — число без розділювача).
 * Дає `create` обрати назву, що спрацює, замість падіння на наявному checkout.
 * @param {string} branch бажане імʼя гілки
 * @param {(candidate: string) => boolean} isTaken чи зайнята (checkout-каталог уже існує)
 * @returns {string} перша вільна назва (= `branch`, якщо вільна)
 */
function firstFreeBranch(branch, isTaken) {
  if (!isTaken(branch)) return branch
  for (let n = 2; n <= FIRST_FREE_LIMIT; n++) {
    const candidate = `${branch}${n}`
    if (!isTaken(candidate)) return candidate
  }
  throw new Error(`worktree: не знайдено вільної назви для "${branch}" за ${FIRST_FREE_LIMIT} спроб`)
}

/**
 * Нагадування про незакомічені зміни основного дерева (вони НЕ потраплять у worktree —
 * він від HEAD). До `limit` файлів — перелік шляхів; більше — лише кількість.
 * @param {string} porcelain вивід `git status --porcelain`
 * @returns {string | null} текст або null, якщо дерево чисте
 */
function buildDirtyNotice(porcelain) {
  const files = String(porcelain ?? '')
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(Boolean)
  if (files.length === 0) return null
  const head = `⚠️  Основне дерево має ${files.length} незакомічених змін — вони НЕ потрапили в цей worktree (створено від HEAD).`
  if (files.length > DIRTY_LIST_LIMIT) return head
  const list = files.map(f => `   - ${f}`).join('\n')
  return `${head}\n${list}`
}

/**
 * Імена активних worktree-checkout (останній компонент шляху) з git.
 * @param {string} root корінь репо
 * @param {(cmd: string, opts?: object) => string} execSyncFn git-виклик
 * @returns {Set<string>} імена активних checkout
 */
function activeCheckoutNames(root, execSyncFn) {
  try {
    const out = execSyncFn('git worktree list --porcelain', { cwd: root })
    const names = new Set()
    for (const p of parseWorktreeList(out)) {
      const name = p.split('/').pop() ?? ''
      if (name) names.add(name)
    }
    return names
  } catch {
    return new Set()
  }
}

/**
 * Імена інвентарів `.meta/*.md` (basenames без `.md`).
 * @param {string} worktreesDir абсолютний worktrees_dir
 * @param {(d: string) => string[]} readdir лістинг каталогу
 * @returns {string[]} sanitized-імена
 */
function inventoryNames(worktreesDir, readdir) {
  try {
    return readdir(metaDirPath(worktreesDir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3))
  } catch {
    return []
  }
}

/**
 * Зчитує опис (перший не-`#`/не-`Created:` рядок) з інвентаря.
 * @param {WorktreeCtx} ctx контекст
 * @param {string} sanitized sanitized імʼя
 * @returns {string} опис або ''
 */
function readDescription(ctx, sanitized) {
  try {
    const lines = ctx.readFile(inventoryPath(ctx.worktreesDir, sanitized), 'utf8').split('\n')
    return lines.find(l => l && !l.startsWith('#') && !l.startsWith('Created:'))?.trim() ?? ''
  } catch {
    return ''
  }
}

/**
 * `create <branch> "<опис>"` — створити ефемерний worktree від HEAD + інвентар.
 * @param {string[]} args [branch, ...descParts]
 * @param {WorktreeCtx} ctx контекст
 * @returns {number} exit code
 */
function cmdCreate(args, ctx) {
  const { root, worktreesDir, log, execSyncFn, exists, writeFile, mkdirFn } = ctx
  const [branch, ...rest] = args
  if (!branch) {
    log('Usage: mt worktree create <branch> "<опис>"')
    return 1
  }
  const description = rest.join(' ').trim()
  if (!description) {
    log('create: опис обовʼязковий — mt worktree create <branch> "<опис>"')
    return 1
  }
  if (!sanitizeBranch(branch)) {
    log(`Error: неможливо нормалізувати ім'я гілки "${branch}"`)
    return 1
  }

  const isTaken = name => exists(join(worktreesDir, sanitizeBranch(name)))
  const chosen = firstFreeBranch(branch, isTaken)
  const sanitized = sanitizeBranch(chosen)
  if (chosen !== branch) log(`ℹ️  гілка/worktree "${branch}" уже існує — обрано вільну назву "${chosen}"`)

  // dirty-notice знімаємо ДО створення (інакше новий checkout/інвентар забруднив би status).
  let dirty = null
  try {
    dirty = buildDirtyNotice(execSyncFn('git status --porcelain', { cwd: root }))
  } catch {
    // git недоступний — пропускаємо нагадування
  }

  const worktreePath = join(worktreesDir, sanitized)
  mkdirFn(worktreesDir, { recursive: true })
  try {
    execSyncFn(`git worktree add -b "${chosen}" "${worktreePath}" HEAD`, { cwd: root })
  } catch (error) {
    log(`Error: git worktree add failed: ${error.message ?? error}`)
    return 1
  }

  mkdirFn(metaDirPath(worktreesDir), { recursive: true })
  writeFile(inventoryPath(worktreesDir, sanitized), inventoryContent(chosen, description))
  log(`✓ worktree створено: ${worktreePath}`)
  log(`  Гілка: ${chosen}`)
  log(`  Опис: ${description}`)
  if (dirty) log(dirty)
  return 0
}

/**
 * `remove <branch>` — прибрати checkout + інвентар + git-гілку (ефемерний).
 * @param {string[]} args [branch]
 * @param {WorktreeCtx} ctx контекст
 * @returns {number} exit code
 */
function cmdRemove(args, ctx) {
  const { root, worktreesDir, log, execSyncFn, exists, rmFile } = ctx
  const [branch] = args
  if (!branch) {
    log('Usage: mt worktree remove <branch>')
    return 1
  }
  const sanitized = sanitizeBranch(branch)
  const worktreePath = join(worktreesDir, sanitized)
  if (!exists(worktreePath)) {
    log(`Worktree ${worktreePath} не знайдено.`)
    return 1
  }

  try {
    execSyncFn(`git worktree remove --force "${worktreePath}"`, { cwd: root })
  } catch {
    try {
      rmFile(worktreePath)
      execSyncFn('git worktree prune', { cwd: root })
    } catch (error) {
      log(`Error: не вдалось видалити worktree: ${error.message ?? error}`)
      return 1
    }
  }

  // Ефемерний worktree: гілку теж прибираємо.
  try {
    execSyncFn(`git branch -D "${branch}"`, { cwd: root })
  } catch {
    // гілка вже могла бути видалена
  }

  const inv = inventoryPath(worktreesDir, sanitized)
  if (exists(inv)) rmFile(inv)
  log(`✓ worktree видалено: ${worktreePath} (гілку ${branch} прибрано)`)
  return 0
}

/**
 * `list` — активні (✓) та осиротілі (⚠️) developer-worktrees з описами.
 * @param {string[]} _args ігнорується
 * @param {WorktreeCtx} ctx контекст
 * @returns {number} exit code
 */
function cmdList(_args, ctx) {
  const { root, worktreesDir, log, execSyncFn, readdir } = ctx
  const active = activeCheckoutNames(root, execSyncFn)
  const names = inventoryNames(worktreesDir, readdir)
  if (names.length === 0) {
    log('Немає developer-worktrees.')
    return 0
  }
  for (const sanitized of names) {
    const desc = readDescription(ctx, sanitized)
    const status = active.has(sanitized) ? '✓' : '⚠️ осиротілий'
    const descPart = desc ? `  — ${desc}` : ''
    log(`  ${status}  ${sanitized}${descPart}`)
  }
  return 0
}

/**
 * `prune` — `git worktree prune` + видалити осиротілі інвентарі.
 * @param {string[]} _args ігнорується
 * @param {WorktreeCtx} ctx контекст
 * @returns {number} exit code
 */
function cmdPrune(_args, ctx) {
  const { root, worktreesDir, log, execSyncFn, readdir, rmFile } = ctx
  try {
    execSyncFn('git worktree prune', { cwd: root })
  } catch {
    // git недоступний — все одно приберемо осиротілі інвентарі за станом нижче
  }
  const active = activeCheckoutNames(root, execSyncFn)
  const orphans = inventoryNames(worktreesDir, readdir).filter(name => !active.has(name))
  for (const name of orphans) {
    rmFile(inventoryPath(worktreesDir, name))
    log(`🧹 видалено осиротілий інвентар: ${name}`)
  }
  log(`prune завершено (осиротілих інвентарів: ${orphans.length})`)
  return 0
}

/**
 * `inventory` — JSON-масив `{name, active, description}` для task-graph.
 * @param {string[]} _args ігнорується
 * @param {WorktreeCtx} ctx контекст
 * @returns {number} exit code
 */
function cmdInventory(_args, ctx) {
  const { root, worktreesDir, log, execSyncFn, readdir } = ctx
  const active = activeCheckoutNames(root, execSyncFn)
  const items = inventoryNames(worktreesDir, readdir).map(sanitized => ({
    name: sanitized,
    active: active.has(sanitized),
    description: readDescription(ctx, sanitized)
  }))
  log(JSON.stringify(items, null, 2))
  return 0
}

/**
 * Точка входу команди `mt worktree`.
 * @param {string[]} args аргументи після `worktree`
 * @param {object} [deps] ін'єкції (cwd/log/config/fs/execSync) для тестів
 * @returns {number} exit code
 */
export default function worktree(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? (s => process.stdout.write(s + '\n'))
  const cfg = deps.config ?? loadConfig({ readFile: deps.readFile })
  const worktreesDir = resolveWorktreesDir(cfg, root)
  // eslint-disable-next-line sonarjs/os-command
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { encoding: 'utf8', ...o }))
  const exists = deps.exists ?? existsSync
  const writeFile = deps.writeFile ?? ((p, c) => writeFileSync(p, c, 'utf8'))
  const readFile = deps.readFile ?? readFileSync
  const readdir = deps.readdir ?? (d => readdirSync(d))
  const rmFile = deps.rmFile ?? (p => rmSync(p, { recursive: true, force: true }))
  const mkdirFn = deps.mkdir ?? ((p, o) => mkdirSync(p, o))

  const [sub, ...rest] = args
  const ctx = { root, worktreesDir, log, execSyncFn, exists, writeFile, readFile, readdir, rmFile, mkdirFn }

  switch (sub) {
    case 'create': {
      return cmdCreate(rest, ctx)
    }
    case 'remove': {
      return cmdRemove(rest, ctx)
    }
    case 'list': {
      return cmdList(rest, ctx)
    }
    case 'prune': {
      return cmdPrune(rest, ctx)
    }
    case 'inventory': {
      return cmdInventory(rest, ctx)
    }
    default: {
      log('Usage: mt worktree <create|remove|list|prune|inventory>')
      log('  create <branch> "<опис>"  — створити ефемерний worktree у .worktrees/<branch>/')
      log('  remove <branch>           — видалити worktree + гілку')
      log('  list                      — активні та осиротілі worktrees')
      log('  prune                     — прибрати осиротілі інвентарі')
      log('  inventory                 — JSON-стан для task-graph')
      return 1
    }
  }
}
