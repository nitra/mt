import { describe, expect, test } from 'vitest'
import { CONFIG_DEFAULTS, loadConfig, resolveMtDir } from '../core/config.mjs'

describe('CONFIG_DEFAULTS', () => {
  test('mt_dir default is ./mt', () => {
    expect(CONFIG_DEFAULTS.mt_dir).toBe('./mt')
  })

  test('does not have tasks_dir key', () => {
    expect(CONFIG_DEFAULTS).not.toHaveProperty('tasks_dir')
  })

  test('uses the MT-local system prompt path', () => {
    expect(CONFIG_DEFAULTS.system_prompt).toBe('.mt/system-prompt.md')
  })
})

describe('loadConfig', () => {
  test('returns mt_dir default when config file does not exist', () => {
    const cfg = loadConfig({ root: '/repo', exists: () => false })
    expect(cfg.mt_dir).toBe('./mt')
  })

  test('reads .mt.json, not .n-cursor.json', () => {
    const readPaths = []
    const exists = p => {
      readPaths.push(p)
      return p.endsWith('.mt.json')
    }

    loadConfig({ root: '/repo', exists, readFile: () => JSON.stringify({ mt_dir: './custom-mt' }) })

    const checkedMt = readPaths.some(p => p.endsWith('/.mt.json'))
    const checkedNCursor = readPaths.some(p => p.endsWith('/.n-cursor.json'))

    expect(checkedMt).toBe(true)
    expect(checkedNCursor).toBe(false)
  })

  test('merges .mt.json override into defaults', () => {
    const cfg = loadConfig({
      root: '/repo',
      exists: p => p.endsWith('.mt.json'),
      readFile: () => JSON.stringify({ mt_dir: './my-tasks', max_worktrees: 12 })
    })
    expect(cfg.mt_dir).toBe('./my-tasks')
    expect(cfg.max_worktrees).toBe(12)
    // other defaults preserved
    expect(cfg.worktrees_dir).toBe('./.worktrees')
  })

  test('falls back to defaults if .mt.json is invalid JSON', () => {
    const cfg = loadConfig({
      root: '/repo',
      exists: p => p.endsWith('.mt.json'),
      readFile: () => 'not json {'
    })
    expect(cfg.mt_dir).toBe('./mt')
  })

  test('model_map is deeply merged', () => {
    const cfg = loadConfig({
      root: '/repo',
      exists: p => p.endsWith('.mt.json'),
      readFile: () => JSON.stringify({ model_map: { MIM: 'custom-haiku' } })
    })
    expect(cfg.model_map.MIM).toBe('custom-haiku')
    expect(cfg.model_map.AVG).toBe(CONFIG_DEFAULTS.model_map.AVG)
  })
})

describe('resolveMtDir', () => {
  test('resolves relative mt_dir against root', () => {
    expect(resolveMtDir({ mt_dir: './mt' }, '/repo')).toBe('/repo/mt')
  })

  test('returns absolute mt_dir unchanged', () => {
    expect(resolveMtDir({ mt_dir: '/abs/path/mt' }, '/repo')).toBe('/abs/path/mt')
  })

  test('resolves custom relative path', () => {
    expect(resolveMtDir({ mt_dir: './custom-tasks' }, '/project')).toBe('/project/custom-tasks')
  })
})
