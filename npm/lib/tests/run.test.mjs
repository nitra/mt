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
 * Репозиторій для підписочного CLI-шляху: опційні `## Check` у task.md і
 * вміст `a.md` (per-node override). Конфіг виконавців — user-level ENV
 * (`MT_AGENT_CLI` / `MT_CLOUD_AGENT_CLIS` / `MT_AGENT_CLI_MODEL_MAP`),
 * інжектиться у `run()` через deps.env.
 * @param {{ check?: string, aMd?: string }} [opts] опції фікстури
 * @returns {string} корінь тимчасового репо
 */
function createCliRepo(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mt-run-cli-'))
  createdDirs.push(root)
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'mt-test@example.test'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'MT Test'], { cwd: root })
  mkdirSync(join(root, 'mt', 'demo'), { recursive: true })
  const check = opts.check ? `\n## Check\n\n${opts.check}\n` : ''
  writeFileSync(
    join(root, 'mt', 'demo', 'task.md'),
    `---\nmode: agent\nbudget_sec: 60\nexecutor:\n  type: agent\n  model_tier: AVG\n---\n\n## Task\n\nDemo\n${check}`,
    'utf8'
  )
  if (opts.aMd) writeFileSync(join(root, 'mt', 'demo', 'a.md'), opts.aMd, 'utf8')
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

/**
 * CLI-фікстура для ladder-тестів: фіксує env і пише fact із правильним NNN
 * (після seedFailedStreak наступний run — не 001).
 * @param {{ env?: Record<string, string> }} seen акумулятор побаченого env
 * @returns {(command: string, args: string[], options: object) => { status: number }} spawnSync-фікстура
 */
function ladderSpawn(seen) {
  return (_command, _args, options) => {
    seen.env = options.env
    writeFileSync(join(options.cwd, `fact_${options.env.MT_RUN_NNN}.md`), '## Result\n\nready\n', 'utf8')
    return { status: 0 }
  }
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

describe('mt run — підписочні CLI-виконавці (MT_AGENT_CLI)', () => {
  test('контракт env вузла: тир, run-token, node-dir, щабель драбини', () => {
    const root = createCliRepo()
    const seen = {}
    const spawnCli = (command, args, options) => {
      seen.env = options.env
      writeFileSync(join(options.cwd, 'fact_001.md'), '## Result\n\nready\n', 'utf8')
      return { status: 0 }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn() })).toBe(0)

    expect(seen.env.MT_MODEL_TIER).toBe('AVG')
    expect(seen.env.MT_RUN_TOKEN).toBeTruthy()
    expect(seen.env.MT_NODE_DIR.endsWith('/mt/demo')).toBe(true)
    // Перша спроба (немає прior run_NNN.md) — базовий щабель драбини, без ескалації.
    expect(seen.env.MT_ATTEMPT).toBe('1')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('base')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe('')
  }, 30_000)

  test('MT_AGENT_CLI=codex — headless `codex exec`, без --model, тир hint-ом env', () => {
    const root = createCliRepo()
    const seen = {}
    const spawnCli = (command, args, options) => {
      seen.command = command
      seen.args = args
      seen.env = options.env
      writeFileSync(join(options.cwd, 'fact_001.md'), '## Result\n\nready\n', 'utf8')
      return { status: 0 }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn(), env: { MT_AGENT_CLI: 'codex' } })).toBe(0)

    expect(seen.command).toBe('codex')
    expect(seen.args[0]).toBe('exec')
    // Без MT_AGENT_CLI_MODEL_MAP модель codex резолвить сам — MT передає лише тир env-ом.
    expect(seen.args).not.toContain('-m')
    expect(seen.args).not.toContain('--model')
    expect(seen.env.MT_AGENT_CLI).toBe('codex')
    expect(seen.env.MT_MODEL_TIER).toBe('AVG')
    expect(readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')).toContain('result: success')
  }, 30_000)

  test('MT_AGENT_CLI_MODEL_MAP — тир MIN/AVG/MAX резолвить конкретну модель CLI (AVG → terra)', () => {
    const root = createCliRepo()
    const env = {
      MT_AGENT_CLI: 'codex',
      MT_AGENT_CLI_MODEL_MAP: JSON.stringify({
        codex: { MIN: 'gpt-5.6-luna', AVG: 'gpt-5.6-terra', MAX: 'gpt-5.6-sola' }
      })
    }
    const seen = {}
    const spawnCli = (command, args, options) => {
      seen.args = args
      writeFileSync(join(options.cwd, 'fact_001.md'), '## Result\n\nready\n', 'utf8')
      return { status: 0 }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn(), env })).toBe(0)

    const mIdx = seen.args.indexOf('-m')
    expect(mIdx).toBeGreaterThan(0)
    expect(seen.args[mIdx + 1]).toBe('gpt-5.6-terra')
  }, 30_000)

  test('a.md «## Agent cli» — per-node override поверх MT_AGENT_CLI (cursor)', () => {
    const root = createCliRepo({ aMd: '## Model tier\n\nAVG\n\n## Agent cli\n\ncursor\n' })
    const seen = {}
    const spawnCli = (command, args, options) => {
      seen.command = command
      writeFileSync(join(options.cwd, 'fact_001.md'), '## Result\n\nready\n', 'utf8')
      return { status: 0 }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn(), env: { MT_AGENT_CLI: 'codex' } })).toBe(0)
    expect(seen.command).toBe('cursor-agent')
  }, 30_000)

  test('невідомий agent CLI → відмова fail-fast без спавну і worktree', () => {
    const root = createCliRepo()
    const spawnCli = vi.fn()

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn(), env: { MT_AGENT_CLI: 'gemini' } })).toBe(1)
    expect(spawnCli).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'mt', 'demo', 'run_001.md'))).toBe(false)
  }, 30_000)

  test('вбудований шлях: fact є, але ## Check провалюється → failed-run', () => {
    const root = createCliRepo({ check: 'false' })

    expect(run(['demo'], { cwd: root, spawnSync: spawnAgentFixture, log: vi.fn() })).toBe(1)
    expect(readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')).toContain('result: failed')
  }, 30_000)
})

describe('mt run — каскад хмарних підписок (MT_CLOUD_AGENT_CLIS)', () => {
  const cascadeEnv = { MT_AGENT_CLI: 'codex', MT_CLOUD_AGENT_CLIS: 'codex,cursor' }

  test('codex вичерпав ліміти → автоматичний каскад на cursor, agent_cli у run_NNN.md', () => {
    const root = createCliRepo()
    const calls = []
    const spawnCli = (command, args, options) => {
      calls.push(command)
      if (command === 'codex') {
        return { status: 1, stderr: 'Rate limit exceeded, try again later' }
      }
      expect(options.env.MT_AGENT_CLI).toBe('cursor')
      writeFileSync(join(options.cwd, 'fact_001.md'), '## Result\n\nready\n', 'utf8')
      return { status: 0 }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn(), env: cascadeEnv })).toBe(0)

    expect(calls).toEqual(['codex', 'cursor-agent'])
    const runMd = readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')
    expect(runMd).toContain('result: success')
    expect(runMd).toContain('agent_cli: cursor')
  }, 30_000)

  test('усі CLI каскаду вичерпані → failed-run без fact', () => {
    const root = createCliRepo()
    const calls = []
    const spawnCli = command => {
      calls.push(command)
      return { status: 1, stdout: 'usage limit reached for your plan' }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn(), env: cascadeEnv })).toBe(1)

    expect(calls).toEqual(['codex', 'cursor-agent'])
    expect(existsSync(join(root, 'mt', 'demo', 'fact_001.md'))).toBe(false)
    expect(readFileSync(join(root, 'mt', 'demo', 'run_001.md'), 'utf8')).toContain('result: failed')
  }, 30_000)

  test('звичайна помилка (без rate-limit-маркера) НЕ каскадує', () => {
    const root = createCliRepo()
    const calls = []
    const spawnCli = command => {
      calls.push(command)
      return { status: 1, stderr: 'syntax error in generated patch' }
    }

    expect(run(['demo'], { cwd: root, spawnSync: spawnCli, log: vi.fn(), env: cascadeEnv })).toBe(1)
    expect(calls).toEqual(['codex'])
  }, 30_000)
})

describe('mt run — retry ladder (MT_ATTEMPT)', () => {
  test('attempt=2 — щабель "diagnose-first" за дефолтною драбиною, tier без ескалації', () => {
    const root = createCliRepo()
    seedFailedStreak(root, 1)
    const seen = {}

    expect(run(['demo'], { cwd: root, spawnSync: ladderSpawn(seen), log: vi.fn() })).toBe(0)

    expect(seen.env.MT_ATTEMPT).toBe('2')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('diagnose-first')
    expect(seen.env.MT_MODEL_TIER).toBe('AVG')
  }, 30_000)

  test('attempt=3 — щабель "alternative-approach" ескалює model_tier AVG → MAX', () => {
    const root = createCliRepo()
    seedFailedStreak(root, 2)
    const seen = {}

    expect(run(['demo'], { cwd: root, spawnSync: ladderSpawn(seen), log: vi.fn() })).toBe(0)

    expect(seen.env.MT_ATTEMPT).toBe('3')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('alternative-approach')
    expect(seen.env.MT_MODEL_TIER).toBe('MAX')
  }, 30_000)

  test('retry_ladder-override у a.md (коротша драбина) — останній щабель повторюється, без ескалації', () => {
    const root = createCliRepo({ aMd: '## Model tier\n\nAVG\n\n## Retry ladder\n\n- base\n- diagnose-first\n' })
    seedFailedStreak(root, 2)
    const seen = {}

    // attempt=3, але override-драбина має довжину 2 → повторює останній щабель
    // ("diagnose-first"), а не дефолтний "alternative-approach" → без ескалації tier.
    expect(run(['demo'], { cwd: root, spawnSync: ladderSpawn(seen), log: vi.fn() })).toBe(0)

    expect(seen.env.MT_ATTEMPT).toBe('3')
    expect(seen.env.MT_RETRY_STRATEGY).toBe('diagnose-first')
    expect(seen.env.MT_MODEL_TIER).toBe('AVG')
  }, 30_000)
})
