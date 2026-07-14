import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

import run from '../commands/run.mjs'

const createdDirs = []

/**
 * Мінімальна фікстура тонкого клієнта: task.md на диску (git не потрібен —
 * claim/worktree/publish живуть у Rust-раннері, який тут мокається).
 * @returns {string} корінь тимчасового репо
 */
function createTaskFixture() {
  const root = mkdtempSync(join(tmpdir(), 'mt-run-'))
  createdDirs.push(root)
  mkdirSync(join(root, 'mt', 'demo'), { recursive: true })
  writeFileSync(join(root, 'mt', 'demo', 'task.md'), '---\nmode: agent\n---\n\n## Mission\n\nDemo\n', 'utf8')
  return root
}

/**
 * Мок napi-аддона: runNode/runAuto підміняються тестом.
 * @param {{
 *   runNode?: (mtDir: string, taskPath: string) => object,
 *   runAuto?: (mtDir: string, concurrency: number) => object[]
 * }} [impl] реалізації
 * @returns {{
 *   runNode: (mtDir: string, taskPath: string) => object,
 *   runAuto: (mtDir: string, concurrency: number) => object[]
 * }} native-мок
 */
function nativeMock(impl = {}) {
  return {
    runNode: impl.runNode ?? vi.fn(),
    runAuto: impl.runAuto ?? vi.fn(() => [])
  }
}

afterEach(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  createdDirs.length = 0
})

describe('mt run — тонкий клієнт Rust-раннера', () => {
  test('agent-шлях делегує native.runNode(mtDir, path); success → 0', () => {
    const root = createTaskFixture()
    const runNode = vi.fn(() => ({
      result: 'success',
      run_file: 'run_001.md',
      fact_file: 'fact_001.md',
      wall_sec: 3,
      agent_cli: 'codex',
      propagated: []
    }))
    const log = vi.fn()

    expect(run(['demo'], { cwd: root, native: nativeMock({ runNode }), log })).toBe(0)

    expect(runNode).toHaveBeenCalledWith(join(root, 'mt'), 'demo')
    const logged = log.mock.calls.flat().join('\n')
    expect(logged).toContain('success')
    expect(logged).toContain('agent_cli=codex')
  })

  test('failed-результат раннера → exit 1 із вказівкою на run_NNN.md', () => {
    const root = createTaskFixture()
    const runNode = vi.fn(() => ({
      result: 'failed',
      run_file: 'run_002.md',
      fact_file: null,
      wall_sec: 7,
      agent_cli: null,
      propagated: []
    }))
    const log = vi.fn()

    expect(run(['demo'], { cwd: root, native: nativeMock({ runNode }), log })).toBe(1)
    expect(log.mock.calls.flat().join('\n')).toContain('run_002.md')
  })

  test('claim-lost («інший runner виграв») → exit 2; інша помилка → 1', () => {
    const root = createTaskFixture()
    const claimLost = nativeMock({
      runNode: vi.fn(() => {
        throw new Error('claim-lost: інший runner уже володіє цим вузлом')
      })
    })
    expect(run(['demo'], { cwd: root, native: claimLost, log: vi.fn() })).toBe(2)

    const noOrigin = nativeMock({
      runNode: vi.fn(() => {
        throw new Error("git fetch origin: no such remote 'origin'")
      })
    })
    expect(run(['demo'], { cwd: root, native: noOrigin, log: vi.fn() })).toBe(1)
  })

  test('невідома задача → 1 без виклику раннера', () => {
    const root = createTaskFixture()
    const native = nativeMock()

    expect(run(['missing'], { cwd: root, native, log: vi.fn() })).toBe(1)
    expect(native.runNode).not.toHaveBeenCalled()
  })

  test('без <path> і без --auto → 1 з usage', () => {
    const root = createTaskFixture()
    const log = vi.fn()
    expect(run([], { cwd: root, native: nativeMock(), log })).toBe(1)
    expect(log.mock.calls.flat().join('\n')).toContain('Usage')
  })

  test('--actor human — інструкції без спавну і без claim', () => {
    const root = createTaskFixture()
    const native = nativeMock()
    const log = vi.fn()

    expect(run(['demo', '--actor', 'human'], { cwd: root, native, log })).toBe(0)

    expect(native.runNode).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join('\n')).toContain('mt done demo')
  })
})

describe('mt run --auto — оркестраторний прохід у Rust-ядрі', () => {
  test('делегує runAuto(mtDir, agent_concurrency); claim-lost — skip, не провал', () => {
    const root = createTaskFixture()
    const runAuto = vi.fn(() => [
      { path: 'a', result: 'success', error: null },
      { path: 'b', result: 'error', error: 'claim-lost: інший runner уже володіє цим вузлом' }
    ])

    expect(run(['--auto'], { cwd: root, native: nativeMock({ runAuto }), log: vi.fn() })).toBe(0)
    // agent_concurrency — з CONFIG_DEFAULTS (5), .mt.json відсутній.
    expect(runAuto).toHaveBeenCalledWith(join(root, 'mt'), 5)
  })

  test('реальний провал вузла у прогоні → 1; порожній прогін → 0', () => {
    const root = createTaskFixture()
    const failed = nativeMock({
      runAuto: vi.fn(() => [{ path: 'a', result: 'budget-exceeded', error: null }])
    })
    expect(run(['--auto'], { cwd: root, native: failed, log: vi.fn() })).toBe(1)

    const log = vi.fn()
    expect(run(['--auto'], { cwd: root, native: nativeMock(), log })).toBe(0)
    expect(log.mock.calls.flat().join('\n')).toContain('немає готових задач')
  })
})
