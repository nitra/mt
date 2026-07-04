import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import init, { parseInitArgs } from '../commands/init.mjs'
import { validateTaskName } from '../core/state.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

const CREATED_RE = /створено/
const EXISTS_RE = /вже існує/
const MODE_FLAG_RE = /--mode/

/**
 * Створює тимчасовий репо з порожньою mt/.
 * @returns {string} абсолютний шлях кореня репо
 */
function tmpRepo() {
  const root = mkdtempSync(join(tmpdir(), 'mt-init-'))
  mkdirSync(join(root, 'mt'), { recursive: true })
  return root
}

/**
 * Мок spawnSync: записує виклики, повертає задану відповідь.
 * @param {object} response відповідь spawnSync (status/stdout/stderr)
 * @returns {{ fn: (bin: string, args: string[], opts: object) => object, calls: object[] }}
 *   мок-функція та журнал викликів
 */
function fakeSpawn(response) {
  const calls = []
  const fn = (bin, args, opts) => {
    calls.push({ bin, args, opts })
    return response
  }
  return { fn, calls }
}

describe('parseInitArgs', () => {
  test("перший non-flag — ім'я, решта — прапорці вербатим", () => {
    const r = parseInitArgs(['research/x', '--mode', 'agent', '--dep', 'a', '--dep', 'b'])
    expect(r.name).toBe('research/x')
    expect(r.flags).toEqual(['--mode', 'agent', '--dep', 'a', '--dep', 'b'])
  })

  test('прапор без значення → помилка', () => {
    expect(parseInitArgs(['x', '--mode']).error).toMatch(MODE_FLAG_RE)
  })
})

describe('mt init (шим над mt-scanner create)', () => {
  test('форвардить create + прапорці й парсить created:true', () => {
    const root = tmpRepo()
    const { fn, calls } = fakeSpawn({
      status: 0,
      stdout: JSON.stringify({ created: true, name: 'demo', task_path: 'demo/task.md', flag: 'a.md', deps: [] })
    })
    const log = vi.fn()
    const code = init(['demo', '--mode', 'agent'], { cwd: root, spawnSync: fn, binPath: '/fake/bin', log })
    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0].bin).toBe('/fake/bin')
    expect(calls[0].args).toEqual(['create', join(root, 'mt'), 'demo', '--mode', 'agent'])
    expect(log.mock.calls.flat().join(' ')).toMatch(CREATED_RE)
    rmSync(root, { recursive: true, force: true })
  })

  test('created:false → лог "вже існує", exit 0', () => {
    const root = tmpRepo()
    const { fn } = fakeSpawn({
      status: 0,
      stdout: JSON.stringify({ created: false, reason: 'exists', name: 'demo', task_path: 'demo/task.md' })
    })
    const log = vi.fn()
    expect(init(['demo'], { cwd: root, spawnSync: fn, binPath: '/fake', log })).toBe(0)
    expect(log.mock.calls.flat().join(' ')).toMatch(EXISTS_RE)
    rmSync(root, { recursive: true, force: true })
  })

  test('без імені → usage, exit 1, бінарник не викликано', () => {
    const { fn, calls } = fakeSpawn({ status: 0, stdout: '{}' })
    expect(init([], { spawnSync: fn, binPath: '/fake', log: vi.fn() })).toBe(1)
    expect(calls).toHaveLength(0)
  })

  test("невалідне ім'я → exit 1, бінарник не викликано", () => {
    const { fn, calls } = fakeSpawn({ status: 0, stdout: '{}' })
    expect(init(['Bad Name'], { spawnSync: fn, binPath: '/fake', log: vi.fn() })).toBe(1)
    expect(calls).toHaveLength(0)
  })

  test('ненульовий exit бінарника → exit 1', () => {
    const root = tmpRepo()
    const { fn } = fakeSpawn({ status: 2, stdout: '', stderr: 'Error: bad' })
    expect(init(['demo'], { cwd: root, spawnSync: fn, binPath: '/fake', log: vi.fn() })).toBe(1)
    rmSync(root, { recursive: true, force: true })
  })
})

// Інтеграція з реальним бінарником (якщо зібраний) — повний контракт JSON+ФС.
describe('mt init ↔ реальний mt-scanner', () => {
  const bin = join(repoRoot, 'target', 'debug', 'mt-scanner')
  test.runIf(existsSync(bin))('створює task.md + прапор через реальний бінарник', () => {
    const root = tmpRepo()
    const code = init(['research/collect-data', '--mode', 'agent', '--model-tier', 'MAX'], {
      cwd: root,
      binPath: bin,
      log: vi.fn()
    })
    expect(code).toBe(0)
    const taskMd = readFileSync(join(root, 'mt', 'research', 'collect-data', 'task.md'), 'utf8')
    expect(taskMd.startsWith('---\nschema_version: 1\n')).toBe(true)
    expect(existsSync(join(root, 'mt', 'research', 'collect-data', 'a.md'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })
})

// Спільні вектори валідації імен (мають збігатися з Rust validate_name).
describe('validateTaskName — спільні вектори', () => {
  const vectors = JSON.parse(readFileSync(join(here, 'fixtures', 'name-vectors.json'), 'utf8'))
  test.each(vectors.valid)('valid: %s', name => {
    expect(validateTaskName(name)).toBeNull()
  })
  test.each(vectors.invalid)('invalid: %j', name => {
    expect(validateTaskName(name)).not.toBeNull()
  })
})
