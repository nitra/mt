import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import run from '../commands/run.mjs'

const createdDirs = []

function createTaskRepo() {
  const root = mkdtempSync(join(tmpdir(), 'mt-run-'))
  createdDirs.push(root)
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'mt-test@example.test'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'MT Test'], { cwd: root })
  mkdirSync(join(root, 'mt', 'demo'), { recursive: true })
  writeFileSync(
    join(root, 'mt', 'demo', 'task.md'),
    '---\nmode: agent\nbudget_sec: 60\nexecutor:\n  type: agent\n  model_tier: AVG\n---\n\n## Mission\n\nDemo\n',
    'utf8'
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

function spawnAgentFixture(_command, _args, options) {
  expect(options.cwd.endsWith('/mt/demo')).toBe(true)
  writeFileSync(join(options.cwd, 'fact_001.md'), '## Result\n\nready\n', 'utf8')
  return { status: 0 }
}

afterEach(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  createdDirs.length = 0
})

describe('mt run', () => {
  // Реальні git init/worktree/merge у tmp — під навантаженою машиною не влазить у default 5s
  test('виконує agent у mt/<task> worktree та мерджить artifacts у main', () => {
    const root = createTaskRepo()

    expect(run(['demo'], { cwd: root, spawnSync: spawnAgentFixture, log: vi.fn() })).toBe(0)
    expect(existsSync(join(root, 'mt', 'demo', 'fact_001.md'))).toBe(true)
    expect(readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')).toContain('result: success')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('')
  }, 30_000)
})
