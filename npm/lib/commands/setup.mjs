/**
 * `mt setup` — ініціалізація проєкту для mt task system.
 *
 * Створює:
 * - .mt.json з дефолтними налаштуваннями (якщо не існує)
 * - mt/ директорію
 * - git hook (post-commit) для автоматичного оновлення стану (якщо є .git)
 *
 * FS ін'єктується для тестованості.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { CONFIG_DEFAULTS } from '../core/config.mjs'

/**
 * Резолвить hooks directory як для звичайного checkout, так і для git worktree.
 * @param {string} root корінь git-репозиторію
 * @returns {string | null} абсолютний шлях до hooks directory
 */
function resolveGitHooksDir(root) {
  try {
    const hooksDir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: root,
      encoding: 'utf8'
    }).trim()
    return isAbsolute(hooksDir) ? hooksDir : join(root, hooksDir)
  } catch {
    return null
  }
}

/**
 * `mt setup` command handler.
 * @param {string[]} _args аргументи (не використовуються)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   writeFile?: (p: string, c: string, enc: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   exists?: (p: string) => boolean,
 *   mkdir?: (p: string, opts?: object) => void,
 *   chmod?: (p: string, mode: number) => void,
 *   resolveHooksDir?: (root: string) => string | null
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code
 */
export default function setup(_args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const writeFile = deps.writeFile ?? ((p, c, enc) => writeFileSync(p, c, enc))
  const exists = deps.exists ?? existsSync
  const mkdir = deps.mkdir ?? ((p, opts) => mkdirSync(p, opts))
  const chmod = deps.chmod ?? chmodSync
  const resolveHooksDir = deps.resolveHooksDir ?? resolveGitHooksDir

  // 1. Створюємо .mt.json якщо не існує
  const configPath = join(root, '.mt.json')
  if (exists(configPath)) {
    log(`setup: ${configPath} вже існує — пропускаємо`)
  } else {
    try {
      writeFile(configPath, JSON.stringify(CONFIG_DEFAULTS, null, 2) + '\n', 'utf8')
      log(`setup: створено ${configPath}`)
    } catch (error) {
      log(`setup: не вдалося створити ${configPath} — ${error.message ?? String(error)}`)
      return 1
    }
  }

  // 2. Створюємо mt/ директорію
  const mtDir = join(root, 'mt')
  if (exists(mtDir)) {
    log(`setup: ${mtDir} вже існує — пропускаємо`)
  } else {
    try {
      mkdir(mtDir, { recursive: true })
      log(`setup: створено ${mtDir}`)
    } catch (error) {
      log(`setup: не вдалося створити ${mtDir} — ${error.message ?? String(error)}`)
      return 1
    }
  }

  // 3. Створюємо parent directory для atomic worktree claims.
  const worktreesDir = join(root, '.worktrees')
  if (!exists(worktreesDir)) {
    try {
      mkdir(worktreesDir, { recursive: true })
      log(`setup: створено ${worktreesDir}`)
    } catch (error) {
      log(`setup: не вдалося створити ${worktreesDir} — ${error.message ?? String(error)}`)
      return 1
    }
  }

  // 4. Перевіряємо чи є .git і додаємо hook
  const gitDir = join(root, '.git')
  if (exists(gitDir)) {
    const hooksDir = resolveHooksDir(root)
    if (!hooksDir) {
      log('setup: не вдалося визначити git hooks directory — пропускаємо hook')
      log('setup: готово')
      return 0
    }
    try {
      mkdir(hooksDir, { recursive: true })
    } catch {
      // hooks/ може вже існувати
    }

    const hookPath = join(hooksDir, 'post-commit')
    if (exists(hookPath)) {
      log(`setup: git hook ${hookPath} вже існує — пропускаємо`)
    } else {
      const hookContent = [
        '#!/bin/sh',
        '# mt: automatic state refresh after commit',
        'mt scan --json > /dev/null 2>&1 || true',
        ''
      ].join('\n')
      try {
        writeFile(hookPath, hookContent, 'utf8')
        chmod(hookPath, 0o755)
        log(`setup: створено git hook ${hookPath}`)
      } catch (error) {
        log(`setup: не вдалося створити git hook — ${error.message ?? String(error)}`)
        // Не критично — продовжуємо
      }
    }
  }

  log('setup: готово')
  return 0
}
