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

/**
 * Екзекутор із ненульовим exit — runner має трактувати як failed-run.
 * @returns {{ status: number, stdout: string }} результат spawnSync
 */
function spawnExecutorFail() {
  return { status: 1, stdout: '' }
}

/**
 * Екзекутор із exit 0 (для перевірки гейта `## Check`, який має провалити run).
 * @returns {{ status: number, stdout: string }} результат spawnSync
 */
function spawnExecutorOk() {
  return { status: 0, stdout: '{"applied":true,"touchedFiles":[]}' }
}

/**
 * Репозиторій із заданим `.mt.json` `node_executor` і task.md (опційно з `## Check`).
 * @param {{ check?: string }} [opts] опції фікстури
 * @returns {string} корінь тимчасового репо
 */
function createExecutorRepo(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mt-run-exec-'))
  createdDirs.push(root)
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'mt-test@example.test'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'MT Test'], { cwd: root })
  writeFileSync(join(root, '.mt.json'), JSON.stringify({ node_executor: 'my-executor --flag' }), 'utf8')
  mkdirSync(join(root, 'mt', 'demo'), { recursive: true })
  const check = opts.check ? `\n## Check\n\n${opts.check}\n` : ''
  writeFileSync(
    join(root, 'mt', 'demo', 'task.md'),
    `---\nmode: agent\nbudget_sec: 60\nexecutor:\n  type: agent\n  model_tier: AVG\n---\n\n## Task\n\nDemo\n${check}`,
    'utf8'
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

/**
 * Симулює `failed_streak` попередніх невдалих спроб — прописує run_NNN.md
 * без відповідного fact_NNN.md (NNN-логіка рахує лише імена файлів).
 * @param {string} root корінь тимчасового репо
 * @param {number} count кількість попередніх failed-ранів
 */
function seedFailedStreak(root, count) {
  for (let i = 1; i <= count; i++) {
    const nnn = String(i).padStart(3, '0')
    writeFileSync(join(root, 'mt', 'demo', `run_${nnn}.md`), '---\nresult: failed\n---\n', 'utf8')
  }
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

describe('mt run — зовнішній екзекутор (node_executor)', () => {
  test('делегує вузол екзекутору, синтезує fact і мерджить (## Check пройдено)', () => {
    const root = createExecutorRepo({ check: 'true' })
    const seen = {}
    // Екзекутор fact НЕ пише — його синтезує runner зі stdout {applied, touchedFiles}.
    const spawnExecutor = (command, args, options) => {
      seen.command = command
      seen.args = args
      seen.env = options.env
      return { status: 0, stdout: 'noise line\n{"applied":true,"touchedFiles":["demo.js"]}' }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnExecutor, log: vi.fn() })).toBe(0)

    // Спавнено саме екзекутор (не claude), node-dir — останній argv.
    expect(seen.command).toBe('my-executor')
    expect(seen.args[0]).toBe('--flag')
    expect(seen.args.at(-1).endsWith('/mt/demo')).toBe(true)
    // Контракт env: тир і run-token передані для harness консюмера.
    expect(seen.env.MT_MODEL_TIER).toBe('AVG')
    expect(seen.env.MT_RUN_TOKEN).toBeTruthy()
    expect(seen.env.MT_NODE_DIR.endsWith('/mt/demo')).toBe(true)
    // Перша спроба (немає прior run_NNN.md) — базовий щабель драбини, без ескалації.
    expect(seen.env.MT_ATTEMPT).toBe('1')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('base')

    const fact = readFileSync(join(root, 'mt', 'demo', 'fact_001.md'), 'utf8')
    expect(fact).toContain('applied=true')
    expect(fact).toContain('demo.js')
    expect(readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')).toContain('result: success')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('')
  }, 30_000)

  test('ненульовий exit екзекутора → failed-run, без fact', () => {
    const root = createExecutorRepo()

    expect(run(['demo'], { cwd: root, spawnSync: spawnExecutorFail, log: vi.fn() })).toBe(1)
    expect(existsSync(join(root, 'mt', 'demo', 'fact_001.md'))).toBe(false)
    expect(readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')).toContain('result: failed')
  }, 30_000)

  test('exit 0 але ## Check провалюється → failed-run, без fact', () => {
    const root = createExecutorRepo({ check: 'false' })

    expect(run(['demo'], { cwd: root, spawnSync: spawnExecutorOk, log: vi.fn() })).toBe(1)
    expect(existsSync(join(root, 'mt', 'demo', 'fact_001.md'))).toBe(false)
    expect(readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')).toContain('result: failed')
  }, 30_000)
})

describe('mt run — retry ladder (MT_ATTEMPT)', () => {
  test('attempt=2 — щабель "diagnose-first" за дефолтною драбиною, tier без ескалації', () => {
    const root = createExecutorRepo()
    seedFailedStreak(root, 1)
    const seen = {}
    const spawnExecutor = (command, args, options) => {
      seen.env = options.env
      return { status: 0, stdout: '{"applied":true,"touchedFiles":[]}' }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnExecutor, log: vi.fn() })).toBe(0)

    expect(seen.env.MT_ATTEMPT).toBe('2')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('diagnose-first')
    expect(seen.env.MT_MODEL_TIER).toBe('AVG')
  }, 30_000)

  test('attempt=3 — щабель "alternative-approach" ескалює model_tier AVG → MAX', () => {
    const root = createExecutorRepo()
    seedFailedStreak(root, 2)
    const seen = {}
    const spawnExecutor = (command, args, options) => {
      seen.env = options.env
      return { status: 0, stdout: '{"applied":true,"touchedFiles":[]}' }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnExecutor, log: vi.fn() })).toBe(0)

    expect(seen.env.MT_ATTEMPT).toBe('3')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('alternative-approach')
    expect(seen.env.MT_MODEL_TIER).toBe('MAX')
  }, 30_000)

  test('retry_ladder-override у a.md (коротша драбина) — останній щабель повторюється, без ескалації', () => {
    const root = createExecutorRepo()
    writeFileSync(
      join(root, 'mt', 'demo', 'a.md'),
      '## Model tier\n\nAVG\n\n## Retry ladder\n\n- base\n- diagnose-first\n',
      'utf8'
    )
    seedFailedStreak(root, 2)
    const seen = {}
    const spawnExecutor = (command, args, options) => {
      seen.env = options.env
      return { status: 0, stdout: '{"applied":true,"touchedFiles":[]}' }
    }

    // attempt=3, але override-драбина має довжину 2 → повторює останній щабель
    // ("diagnose-first"), а не дефолтний "alternative-approach" → без ескалації tier.
    expect(run(['demo'], { cwd: root, spawnSync: spawnExecutor, log: vi.fn() })).toBe(0)

    expect(seen.env.MT_ATTEMPT).toBe('3')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('diagnose-first')
    expect(seen.env.MT_MODEL_TIER).toBe('AVG')
  }, 30_000)
})
