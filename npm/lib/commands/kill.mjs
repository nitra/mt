/**
 * `mt kill <path>` — вбиває worktree задачі і каскадно інвалідує нащадків.
 *
 * 1. Знаходить worktree задачі
 * 2. Видаляє worktree (force)
 * 3. Видаляє plan_*.md (скидає планування)
 * 4. Файловий рівень — mt-core::lifecycle::kill: без run-артефактів вузол
 *    видаляється назавжди, інакше архівується у `.history/`
 * 5. Каскадно інвалідує всі залежні задачі (sentinel `invalidated`)
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveMtDir, resolveWorktreesDir } from '../core/config.mjs'
import { loadNative } from '../core/native.mjs'
import { scanTasks } from '../core/scanner.mjs'
import { findTaskWorktree, listActiveWorktrees, removeWorktree } from '../core/worktree.mjs'

/** Regex для plan_NNN.md файлів. */
const PLAN_FILE_RE = /^plan_\d+\.md$/

/**
 * Записує invalidated sentinel для задачі.
 * @param {string} taskDir директорія задачі
 * @param {(p: string, c: string, enc: string) => void} writeFile функція запису
 */
function writeInvalidated(taskDir, writeFile) {
  writeFile(join(taskDir, 'invalidated'), '', 'utf8')
}

/**
 * Видаляє plan_*.md файли з директорії задачі.
 * @param {string} taskDir директорія задачі
 * @param {string[]} files список файлів
 * @param {(p: string) => void} unlink функція видалення
 */
function deletePlanFiles(taskDir, files, unlink) {
  for (const f of files) {
    if (PLAN_FILE_RE.test(f)) {
      try {
        unlink(join(taskDir, f))
      } catch {
        // пропускаємо
      }
    }
  }
}

/**
 * `mt kill <path>` command handler.
 * @param {string[]} args аргументи: [path]
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   unlink?: (p: string) => void,
 *   execSync?: (cmd: string, opts?: object) => string
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function kill(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  const unlink = deps.unlink ?? unlinkSync

  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))

  const [taskPath] = args
  if (!taskPath) {
    log('Usage: mt kill <path>')
    return 1
  }

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)
  const worktreesDir = resolveWorktreesDir(config, root)

  const taskDir = join(mtDir, taskPath)
  if (!exists(join(taskDir, 'task.md'))) {
    log(`kill: задача "${taskPath}" не знайдена`)
    return 1
  }

  // 1. Знаходимо і видаляємо worktree
  const worktreePath = findTaskWorktree(taskPath, worktreesDir, {
    readdirSync: readdir,
    execSync: execSyncFn
  })

  if (worktreePath) {
    log(`kill: видаляємо worktree ${worktreePath}`)
    removeWorktree(worktreePath, root, { execSync: execSyncFn })
  } else {
    log(`kill: worktree не знайдено для "${taskPath}"`)
  }

  // 2. Видаляємо plan_*.md
  const files = readdir(taskDir)
  deletePlanFiles(taskDir, files, unlink)
  const planCount = files.filter(f => PLAN_FILE_RE.test(f)).length
  if (planCount > 0) {
    log(`kill: видалено ${planCount} plan_*.md файл(ів)`)
  }

  // 3. Файловий рівень — mt-core::lifecycle::kill (одна імплементація
  // контракту): без run-артефактів вузол видаляється назавжди, інакше
  // архівується у `.history/`.
  try {
    const outcome = loadNative().killNode(mtDir, taskPath)
    if (outcome.startsWith('deleted:')) {
      log(`kill: задача "${taskPath}" видалена (run-історії не було)`)
    } else {
      log(`kill: задача "${taskPath}" архівована → ${outcome}`)
    }
  } catch (error) {
    log(`kill: не вдалося вбити вузол — ${error.message ?? String(error)}`)
    return 1
  }

  // 4. Каскадна інвалідація залежних задач
  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })
  const allNodes = scanTasks(mtDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  // Знаходимо задачі що залежать від нашої задачі
  const dependents = allNodes.filter(n => n.deps.includes(taskPath))
  for (const dep of dependents) {
    if (!exists(join(dep.dir, 'invalidated'))) {
      try {
        writeInvalidated(dep.dir, writeFile)
        log(`kill: каскадна інвалідація "${dep.path}"`)
      } catch {
        // пропускаємо
      }
    }
  }

  return 0
}
