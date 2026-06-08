/**
 * Тести `mt setup` handler — clean-break tests.
 * Перевіряємо що setup створює .mt.json і mt/, але НЕ .n-cursor.json і НЕ tasks/.
 */
import { describe, expect, test, vi } from 'vitest'

import setup from '../commands/setup.mjs'

describe('setup', () => {
  test('створює .mt.json у корені', async () => {
    const written = {}
    const code = await setup([], {
      cwd: '/repo',
      exists: () => false,
      writeFile: (p, c) => {
        written[p] = c
      },
      readFile: () => {
        throw new Error('not found')
      },
      mkdir: vi.fn(),
      log: vi.fn()
    })
    expect(code).toBe(0)
    expect(Object.keys(written)).toContain('/repo/.mt.json')
    expect(Object.keys(written)).not.toContain('/repo/.n-cursor.json')
  })

  test('створює mt/ директорію', async () => {
    const created = []
    const code = await setup([], {
      cwd: '/repo',
      exists: () => false,
      writeFile: vi.fn(),
      readFile: () => {
        throw new Error('not found')
      },
      mkdir: p => {
        created.push(p)
      },
      log: vi.fn()
    })
    expect(code).toBe(0)
    expect(created.some(p => p.endsWith('/mt'))).toBe(true)
    expect(created.some(p => p.endsWith('/tasks'))).toBe(false)
  })

  test('створює .worktrees/ директорію для першого запуску', async () => {
    const created = []
    const code = await setup([], {
      cwd: '/repo',
      exists: () => false,
      writeFile: vi.fn(),
      mkdir: p => {
        created.push(p)
      },
      chmod: vi.fn(),
      resolveHooksDir: () => null,
      log: vi.fn()
    })

    expect(code).toBe(0)
    expect(created).toContain('/repo/.worktrees')
  })

  test('робить створений git hook executable', async () => {
    const chmod = vi.fn()
    const code = await setup([], {
      cwd: '/repo',
      exists: p => p === '/repo/.git',
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      chmod,
      resolveHooksDir: () => '/repo/.git/hooks',
      log: vi.fn()
    })

    expect(code).toBe(0)
    expect(chmod).toHaveBeenCalledWith('/repo/.git/hooks/post-commit', 0o755)
  })

  test('НЕ створює tasks/ директорію', async () => {
    const created = []
    await setup([], {
      cwd: '/repo',
      exists: () => false,
      writeFile: vi.fn(),
      readFile: () => {
        throw new Error('not found')
      },
      mkdir: p => {
        created.push(p)
      },
      log: vi.fn()
    })
    expect(created.every(p => !p.endsWith('/tasks'))).toBe(true)
  })

  test('НЕ створює .n-cursor.json', async () => {
    const written = {}
    await setup([], {
      cwd: '/repo',
      exists: () => false,
      writeFile: (p, c) => {
        written[p] = c
      },
      readFile: () => {
        throw new Error('not found')
      },
      mkdir: vi.fn(),
      log: vi.fn()
    })
    expect(Object.keys(written).every(p => !p.endsWith('.n-cursor.json'))).toBe(true)
  })

  test('пропускає .mt.json якщо вже існує', async () => {
    const written = {}
    const log = vi.fn()
    await setup([], {
      cwd: '/repo',
      exists: p => p.endsWith('.mt.json'),
      writeFile: (p, c) => {
        written[p] = c
      },
      readFile: () => {
        throw new Error('not found')
      },
      mkdir: vi.fn(),
      log
    })
    expect(Object.keys(written)).not.toContain('/repo/.mt.json')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('вже існує'))
  })

  test('пропускає mt/ якщо вже існує', async () => {
    const created = []
    const log = vi.fn()
    await setup([], {
      cwd: '/repo',
      exists: p => p.endsWith('/mt'),
      writeFile: vi.fn(),
      readFile: () => {
        throw new Error('not found')
      },
      mkdir: p => {
        created.push(p)
      },
      log
    })
    expect(created.every(p => !p.endsWith('/mt'))).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('вже існує'))
  })

  test('exit 1 якщо writeFile кидає', async () => {
    const code = await setup([], {
      cwd: '/repo',
      exists: () => false,
      writeFile: () => {
        throw new Error('disk full')
      },
      readFile: () => {
        throw new Error('not found')
      },
      mkdir: vi.fn(),
      log: vi.fn()
    })
    expect(code).toBe(1)
  })
})
