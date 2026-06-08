import { describe, expect, test } from 'vitest'
import { NODE_STATES, deriveCompositeState, deriveNodeState, isComposite, sanitizeTaskName } from '../core/state.mjs'

// ------- NODE_STATES order -------

describe('NODE_STATES', () => {
  test('contains all 7 states', () => {
    expect(NODE_STATES).toEqual([
      'needs-plan',
      'waiting',
      'running',
      'pending-audit',
      'resolved',
      'failed',
      'invalidated'
    ])
  })
})

// ------- sanitizeTaskName -------

describe('sanitizeTaskName', () => {
  test('replaces slashes and special chars with hyphens', () => {
    expect(sanitizeTaskName('research/collect data')).toBe('research-collect-data')
  })

  test('leaves alphanumeric, hyphens and underscores unchanged', () => {
    expect(sanitizeTaskName('my-task_01')).toBe('my-task_01')
  })

  test('empty string returns empty string', () => {
    expect(sanitizeTaskName('')).toBe('')
  })
})

// ------- deriveCompositeState precedence -------

describe('deriveCompositeState – precedence', () => {
  test('invalidated > resolved', () => {
    expect(deriveCompositeState(['resolved', 'invalidated'])).toBe('invalidated')
  })

  test('invalidated > running', () => {
    expect(deriveCompositeState(['running', 'invalidated'])).toBe('invalidated')
  })

  test('failed > running (no invalidated)', () => {
    expect(deriveCompositeState(['running', 'failed'])).toBe('failed')
  })

  test('running > pending-audit (no failed/invalidated)', () => {
    expect(deriveCompositeState(['pending-audit', 'running'])).toBe('running')
  })

  test('pending-audit > resolved (no running/failed/invalidated)', () => {
    expect(deriveCompositeState(['resolved', 'pending-audit'])).toBe('pending-audit')
  })

  test('all resolved → resolved', () => {
    expect(deriveCompositeState(['resolved', 'resolved', 'resolved'])).toBe('resolved')
  })

  test('mixed waiting/needs-plan → waiting (fallback)', () => {
    expect(deriveCompositeState(['waiting', 'needs-plan'])).toBe('waiting')
  })

  test('empty array → waiting', () => {
    expect(deriveCompositeState([])).toBe('waiting')
  })
})

// ------- isComposite -------

describe('isComposite', () => {
  test('returns true when a child directory contains task.md', () => {
    const result = isComposite('/node', {
      readdirSync: dir => {
        if (dir === '/node') return ['child']
        return []
      },
      existsSync: p => p === '/node/child/task.md'
    })
    expect(result).toBe(true)
  })

  test('returns false when no child has task.md', () => {
    const result = isComposite('/node', {
      readdirSync: _dir => ['file.md'],
      existsSync: _p => false
    })
    expect(result).toBe(false)
  })

  test('returns false when readdirSync throws', () => {
    const result = isComposite('/node', {
      readdirSync: () => {
        throw new Error('ENOENT')
      },
      existsSync: () => false
    })
    expect(result).toBe(false)
  })
})

// ------- deriveNodeState precedence -------

/**
 * Helper: creates a virtual FS and returns the derived state.
 * @param {{ files: string[], taskContent?: string, activeWorktrees?: string[] }} opts опції тесту
 * @returns {string} деривований стан задачі
 */
function stateFrom({ files, taskContent = '---\nmode: agent\n---\n', activeWorktrees = [] }) {
  const dir = '/task'
  const fileSet = new Set(files)

  const deps = {
    existsSync: p => {
      if (p === `${dir}/task.md`) return fileSet.has('task.md')
      // for child task.md in isComposite
      return false
    },
    readdirSync: d => {
      if (d === dir) return files
      return []
    },
    readFileSync: (p, _enc) => {
      if (p === `${dir}/task.md`) return taskContent
      // run files with result:failed
      if (p.includes('/run_') && p.endsWith('.md')) return 'result: failed'
      return ''
    }
  }

  return deriveNodeState(dir, new Set(activeWorktrees), deps)
}

describe('deriveNodeState – precedence', () => {
  test('needs-plan when task.md is absent', () => {
    expect(stateFrom({ files: [] })).toBe('needs-plan')
  })

  test('needs-plan when only task.md exists and mode is human', () => {
    const state = stateFrom({
      files: ['task.md'],
      taskContent: '---\nmode: human\n---\n'
    })
    expect(state).toBe('needs-plan')
  })

  test('waiting when plan_001.md exists', () => {
    expect(stateFrom({ files: ['task.md', 'plan_001.md'] })).toBe('waiting')
  })

  test('waiting when mode:agent and no other signal', () => {
    const state = stateFrom({
      files: ['task.md'],
      taskContent: '---\nmode: agent\n---\n'
    })
    expect(state).toBe('waiting')
  })

  test('running when active worktree matches sanitized name', () => {
    // dir = /task, nodeName = 'task', sanitizeTaskName('task') = 'task'
    const state = stateFrom({
      files: ['task.md'],
      activeWorktrees: ['task-1234567890'],
      taskContent: '---\nmode: agent\n---\n'
    })
    expect(state).toBe('running')
  })

  test('failed when run_001.md has result:failed and no fact', () => {
    const state = stateFrom({
      files: ['task.md', 'plan_001.md', 'run_001.md'],
      taskContent: '---\nmode: agent\n---\n'
    })
    expect(state).toBe('failed')
  })

  test('pending-audit when pending-audit_001.md exists without audit-result', () => {
    const state = stateFrom({
      files: ['task.md', 'pending-audit_001.md']
    })
    expect(state).toBe('pending-audit')
  })

  test('resolved when fact_001.md exists', () => {
    const state = stateFrom({
      files: ['task.md', 'fact_001.md']
    })
    expect(state).toBe('resolved')
  })

  test('invalidated when sentinel file exists (highest priority)', () => {
    const state = stateFrom({
      files: ['task.md', 'fact_001.md', 'invalidated']
    })
    expect(state).toBe('invalidated')
  })

  test('invalidated > pending-audit > resolved full precedence chain', () => {
    // invalidated beats everything
    expect(stateFrom({ files: ['task.md', 'fact_001.md', 'pending-audit_001.md', 'invalidated'] })).toBe('invalidated')
    // pending-audit must remain visible even when its fact exists
    expect(stateFrom({ files: ['task.md', 'fact_001.md', 'pending-audit_001.md'] })).toBe('pending-audit')
    // pending-audit beats running when no active worktree
    expect(stateFrom({ files: ['task.md', 'pending-audit_001.md'] })).toBe('pending-audit')
  })
})
