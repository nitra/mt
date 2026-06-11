/**
 * `mt watch` — одноразовий скан стану задач.
 *
 * Спрощена (no-daemon) реалізація:
 * - Знаходить pending-audit без audit-result → логує (треба ручний аудит)
 * - Знаходить stale worktrees > stale_worktree_min хвилин → попереджає
 * - Знаходить needs-plan задачі → перелічує
 * - exit 0 якщо чисто, exit 1 якщо потрібна увага
 *
 * FS і child_process ін'єктуються для тестованості.
 */
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cwd as processCwd } from 'node:process'

import { loadConfig, resolveMtDir, resolveWorktreesDir } from '../core/config.mjs'
import { scanTasks } from '../core/scanner.mjs'
import { listActiveWorktrees } from '../core/worktree.mjs'

/**
 * `mt watch` command handler (one-shot scan).
 * @param {string[]} args аргументи (зазвичай порожні)
 * @param {{
 *   cwd?: string,
 *   log?: (m: string) => void,
 *   readFile?: (p: string, enc: string) => string,
 *   readdir?: (d: string) => string[],
 *   exists?: (p: string) => boolean,
 *   execSync?: (cmd: string, opts?: object) => string,
 *   statSync?: (p: string) => { mtimeMs: number },
 *   now?: () => number
 * }} [deps] ін'єкції
 * @returns {Promise<number>} exit code (0=clean, 1=attention)
 */
export default function watch(args, deps = {}) {
  const root = deps.cwd ?? processCwd()
  const log = deps.log ?? console.log
  const readFile = deps.readFile ?? ((p, enc) => readFileSync(p, enc))
  const readdir = deps.readdir ?? (d => (existsSync(d) ? readdirSync(d) : []))
  const exists = deps.exists ?? existsSync
  // eslint-disable-next-line sonarjs/os-command
  const execSyncFn = deps.execSync ?? ((cmd, o) => execSync(cmd, { ...o, encoding: 'utf8' }))
  const statFn = deps.statSync ?? statSync
  const nowMs = deps.now ?? (() => Date.now())

  const config = loadConfig({ root, readFile, exists })
  const mtDir = resolveMtDir(config, root)
  const worktreesDir = resolveWorktreesDir(config, root)
  const staleMs = config.stale_worktree_min * 60 * 1000

  const activeWorktrees = listActiveWorktrees(root, { execSync: execSyncFn })

  const allNodes = scanTasks(mtDir, activeWorktrees, {
    readdirSync: readdir,
    existsSync: exists,
    readFileSync: readFile
  })

  let needsAttention = false

  // 1. Pending-audit без audit-result
  const pendingAudit = allNodes.filter(n => n.state === 'pending-audit')
  if (pendingAudit.length > 0) {
    needsAttention = true
    log(`[watch] pending-audit (${pendingAudit.length}) — потрібна ручна перевірка:`)
    for (const n of pendingAudit) {
      log(`  - ${n.path}`)
    }
  }

  // 2. Stale worktrees
  let worktreeEntries = []
  try {
    worktreeEntries = readdir(worktreesDir)
  } catch {
    // worktrees dir може не існувати
  }

  const now = nowMs()
  const staleWorktrees = []
  for (const name of worktreeEntries) {
    const wtPath = join(worktreesDir, name)
    try {
      const stat = statFn(wtPath)
      const ageMs = now - stat.mtimeMs
      if (ageMs > staleMs) {
        staleWorktrees.push({ name, ageMin: Math.floor(ageMs / 60000) })
      }
    } catch {
      // пропускаємо
    }
  }

  if (staleWorktrees.length > 0) {
    needsAttention = true
    log(`[watch] stale worktrees (${staleWorktrees.length}) — неактивні > ${config.stale_worktree_min} хв:`)
    for (const wt of staleWorktrees) {
      log(`  - ${wt.name} (${wt.ageMin} хв)`)
    }
  }

  // 3. Задачі що потребують людської уваги
  const unassigned = allNodes.filter(n => n.state === 'unassigned')
  if (unassigned.length > 0) {
    log(`[watch] unassigned (${unassigned.length}) — немає виконавця:`)
    for (const n of unassigned) {
      log(`  - ${n.path}`)
    }
  }

  const pendingNodes = allNodes.filter(n => n.state === 'pending')
  if (pendingNodes.length > 0) {
    log(`[watch] pending (${pendingNodes.length}) — чекають людину:`)
    for (const n of pendingNodes) {
      log(`  - ${n.path}`)
    }
  }

  const planReview = allNodes.filter(n => n.state === 'plan-review')
  if (planReview.length > 0) {
    log(`[watch] plan-review (${planReview.length}) — чекають approve:`)
    for (const n of planReview) {
      log(`  - ${n.path}`)
    }
  }

  const unresolvable = allNodes.filter(n => n.state === 'unresolvable')
  if (unresolvable.length > 0) {
    needsAttention = true
    log(`[watch] unresolvable (${unresolvable.length}) — вичерпано спроби:`)
    for (const n of unresolvable) {
      log(`  - ${n.path}`)
    }
  }

  // 4. Failed задачі
  const failed = allNodes.filter(n => n.state === 'failed')
  if (failed.length > 0) {
    needsAttention = true
    log(`[watch] failed (${failed.length}) — завершились з помилкою:`)
    for (const n of failed) {
      log(`  - ${n.path}`)
    }
  }

  if (!needsAttention && pendingAudit.length === 0 && failed.length === 0) {
    const running = allNodes.filter(n => n.state === 'running').length
    const resolved = allNodes.filter(n => n.state === 'resolved').length
    log(`[watch] OK — total:${allNodes.length} running:${running} resolved:${resolved}`)
  }

  return needsAttention ? 1 : 0
}
