import { describe, test, expect } from 'vitest'
import worktree from '../worktree.mjs'

const CREATED_RE = /Created: \d{4}-\d{2}-\d{2}/

function makeCtx(overrides = {}) {
  const logs = []
  const fs = {}

  const deps = {
    cwd: '/repo',
    log: s => {
      logs.push(s)
    },
    config: { worktrees_dir: './.worktrees' },
    mkdir: () => null,
    exists: p => Object.hasOwn(fs, p),
    writeFile: (p, c) => {
      fs[p] = c
    },
    readFile: p => {
      if (Object.hasOwn(fs, p)) return fs[p]
      const e = new Error('ENOENT')
      e.code = 'ENOENT'
      throw e
    },
    // mock ігнорує каталог і повертає basenames усіх .md-ключів (інвентарі живуть у .meta/)
    readdir: () =>
      Object.keys(fs)
        .filter(k => k.endsWith('.md'))
        .map(k => k.split('/').pop()),
    rmFile: p => {
      delete fs[p]
    },
    execSync: () => '',
    ...overrides
  }

  return { logs, fs, deps }
}

describe('sanitizeBranch (via create)', () => {
  test('feat/my-feature → feat-my-feature; інвентар у .meta/', () => {
    const { deps, fs, logs } = makeCtx({ execSync: () => '' })
    const code = worktree(['create', 'feat/my-feature', 'test desc'], deps)
    expect(code).toBe(0)
    expect(logs.some(l => l.includes('feat-my-feature'))).toBe(true)
    expect(fs).toHaveProperty('/repo/.worktrees/.meta/feat-my-feature.md')
  })

  test('подвійний слеш → один дефіс', () => {
    const { deps, fs } = makeCtx({ execSync: () => '' })
    worktree(['create', 'double//slash', 'desc'], deps)
    expect(Object.keys(fs)).toContain('/repo/.worktrees/.meta/double-slash.md')
  })
})

describe('create', () => {
  test('повертає 1 без branch', () => {
    const { deps } = makeCtx()
    expect(worktree(['create'], deps)).toBe(1)
  })

  test('повертає 1 без опису (опис обовʼязковий)', () => {
    const { deps } = makeCtx()
    expect(worktree(['create', 'feat/x'], deps)).toBe(1)
  })

  test('колізія → firstFreeBranch обирає <branch>2 (не падає)', () => {
    const { deps, fs, logs } = makeCtx({ execSync: () => '' })
    fs['/repo/.worktrees/my-branch'] = '' // checkout уже існує
    const code = worktree(['create', 'my-branch', 'desc'], deps)
    expect(code).toBe(0)
    expect(logs.some(l => l.includes('обрано вільну назву') && l.includes('my-branch2'))).toBe(true)
    expect(fs).toHaveProperty('/repo/.worktrees/.meta/my-branch2.md')
  })

  test('uncommitted warning з переліком', () => {
    const { deps, logs } = makeCtx({
      execSync: cmd => (cmd.includes('status') ? ' M file.txt' : '')
    })
    worktree(['create', 'feat/warn', 'desc'], deps)
    expect(logs.some(l => l.includes('незакоміче') && l.includes('file.txt'))).toBe(true)
  })

  test('git fail → повертає 1', () => {
    const { deps } = makeCtx({
      execSync: cmd => {
        if (cmd.includes('worktree add')) {
          throw new Error('git fail')
        }
        return ''
      }
    })
    expect(worktree(['create', 'feat/fail', 'desc'], deps)).toBe(1)
  })

  test('інвентар містить branch + description + дату', () => {
    const { deps, fs } = makeCtx({ execSync: () => '' })
    worktree(['create', 'feat/inv', 'My feature'], deps)
    const content = fs['/repo/.worktrees/.meta/feat-inv.md']
    expect(content).toContain('# feat/inv')
    expect(content).toContain('My feature')
    expect(content).toMatch(CREATED_RE)
  })
})

describe('remove (ефемерний — прибирає гілку)', () => {
  test('повертає 1 без branch', () => {
    const { deps } = makeCtx()
    expect(worktree(['remove'], deps)).toBe(1)
  })

  test('повертає 1 якщо worktree немає', () => {
    const { deps } = makeCtx({ exists: () => false })
    expect(worktree(['remove', 'feat/none'], deps)).toBe(1)
  })

  test('видаляє інвентар .meta/*.md', () => {
    const { deps, fs } = makeCtx({ execSync: () => '' })
    fs['/repo/.worktrees/feat-del'] = ''
    fs['/repo/.worktrees/.meta/feat-del.md'] = 'content'
    const code = worktree(['remove', 'feat/del'], deps)
    expect(code).toBe(0)
    expect(fs).not.toHaveProperty('/repo/.worktrees/.meta/feat-del.md')
  })

  test('видаляє гілку через git branch -D', () => {
    const cmds = []
    const { deps, fs } = makeCtx({
      execSync: cmd => {
        cmds.push(cmd)
        return ''
      }
    })
    fs['/repo/.worktrees/my-branch'] = ''
    fs['/repo/.worktrees/.meta/my-branch.md'] = 'content'
    worktree(['remove', 'my-branch'], deps)
    expect(cmds.some(c => c.includes('branch -D') && c.includes('my-branch'))).toBe(true)
  })
})

describe('list', () => {
  test('без worktrees → виводить повідомлення', () => {
    const { deps, logs } = makeCtx({ execSync: () => '', readdir: () => [] })
    worktree(['list'], deps)
    expect(logs.some(l => l.includes('Немає'))).toBe(true)
  })

  test('показує активні та осиротілі', () => {
    const { deps, fs, logs } = makeCtx({
      execSync: cmd =>
        cmd.includes('list --porcelain') ? 'worktree /repo/.worktrees/feat-a\nbranch refs/heads/feat/a\n' : ''
    })
    fs['/repo/.worktrees/.meta/feat-a.md'] = '# feat/a\n\nDesc A\n\nCreated: 2026-06-01\n'
    fs['/repo/.worktrees/.meta/feat-b.md'] = '# feat/b\n\nDesc B\n\nCreated: 2026-06-02\n'
    worktree(['list'], deps)
    expect(logs.some(l => l.includes('✓') && l.includes('feat-a'))).toBe(true)
    expect(logs.some(l => l.includes('осиротілий') && l.includes('feat-b'))).toBe(true)
  })
})

describe('prune', () => {
  test('видаляє осиротілі інвентарі (без активного checkout)', () => {
    const { deps, fs, logs } = makeCtx({
      execSync: cmd => (cmd.includes('list --porcelain') ? 'worktree /repo/.worktrees/feat-a\n' : '')
    })
    fs['/repo/.worktrees/.meta/feat-a.md'] = '# feat/a\n' // активний
    fs['/repo/.worktrees/.meta/feat-orphan.md'] = '# feat/orphan\n' // осиротілий
    worktree(['prune'], deps)
    expect(fs).toHaveProperty('/repo/.worktrees/.meta/feat-a.md')
    expect(fs).not.toHaveProperty('/repo/.worktrees/.meta/feat-orphan.md')
    expect(logs.some(l => l.includes('feat-orphan'))).toBe(true)
  })
})

describe('inventory', () => {
  test('JSON-масив зі станом active', () => {
    const { deps, fs, logs } = makeCtx({
      execSync: cmd => (cmd.includes('list --porcelain') ? 'worktree /repo/.worktrees/feat-a\n' : '')
    })
    fs['/repo/.worktrees/.meta/feat-a.md'] = '# feat/a\n\nDesc A\n\nCreated: 2026-06-01\n'
    fs['/repo/.worktrees/.meta/feat-b.md'] = '# feat/b\n\nDesc B\n\nCreated: 2026-06-02\n'
    worktree(['inventory'], deps)
    const json = JSON.parse(logs.join('\n'))
    expect(json).toEqual([
      { name: 'feat-a', active: true, description: 'Desc A' },
      { name: 'feat-b', active: false, description: 'Desc B' }
    ])
  })
})

describe('unknown subcommand', () => {
  test('повертає 1', () => {
    const { deps } = makeCtx()
    expect(worktree(['wtf'], deps)).toBe(1)
  })
})
