import { describe, expect, test } from 'vitest'
import { NODE_STATES, deriveNodeState, isComposite, sanitizeTaskName } from '../core/state.mjs'

// ------- NODE_STATES -------

describe('NODE_STATES', () => {
  test('contains all 12 spec states in order', () => {
    expect(NODE_STATES).toEqual([
      'unassigned',
      'pending',
      'waiting',
      'blocked',
      'plan-review',
      'spawned',
      'running',
      'stalled',
      'pending-audit',
      'resolved',
      'failed',
      'unresolvable'
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

// ------- deriveNodeState helpers -------

/**
 * Будує віртуальну FS і повертає деривований стан задачі.
 * @param {{
 *   files: string[],
 *   fileContents?: Record<string, string>,
 *   activeWorktrees?: string[],
 *   relPath?: string,
 *   agentRetryMax?: number
 * }} opts
 */
function stateFrom({
  files,
  fileContents = {},
  activeWorktrees = [],
  relPath,
  agentRetryMax
}) {
  const dir = '/task'
  const fileSet = new Set(files)

  const fsDeps = {
    existsSync: p => {
      if (p === `${dir}/task.md`) return fileSet.has('task.md')
      // isComposite child check
      return false
    },
    readdirSync: d => {
      if (d === dir) return files
      // deps/ directory — empty by default
      return []
    },
    readFileSync: (p, _enc) => {
      const name = p.replace(`${dir}/`, '')
      if (name in fileContents) return fileContents[name]
      return ''
    }
  }

  return deriveNodeState(dir, new Set(activeWorktrees), {
    ...fsDeps,
    ...(relPath !== undefined ? { relPath } : {}),
    ...(agentRetryMax !== undefined ? { agentRetryMax } : {})
  })
}

// ------- unassigned -------

describe('deriveNodeState — unassigned', () => {
  test('unassigned when task.md is absent', () => {
    expect(stateFrom({ files: [] })).toBe('unassigned')
  })

  test('unassigned when task.md exists but no a.md/h.md', () => {
    expect(stateFrom({ files: ['task.md'] })).toBe('unassigned')
  })

  test('unassigned when readdirSync throws', () => {
    const state = deriveNodeState(
      '/task',
      new Set(),
      {
        existsSync: p => p === '/task/task.md',
        readdirSync: () => { throw new Error('EPERM') },
        readFileSync: () => ''
      }
    )
    expect(state).toBe('unassigned')
  })
})

// ------- pending -------

describe('deriveNodeState — pending', () => {
  test('pending when h.md exists and no fact', () => {
    expect(stateFrom({ files: ['task.md', 'h.md'] })).toBe('pending')
  })

  test('pending with h.md and plan (no a.md)', () => {
    expect(stateFrom({ files: ['task.md', 'h.md', 'plan_001.md'] })).toBe('pending')
  })
})

// ------- waiting -------

describe('deriveNodeState — waiting', () => {
  test('waiting when a.md exists and no runs', () => {
    expect(stateFrom({ files: ['task.md', 'a.md'] })).toBe('waiting')
  })

  test('waiting when a.md exists and has plan', () => {
    expect(stateFrom({ files: ['task.md', 'a.md', 'plan_001.md'] })).toBe('waiting')
  })

  test('waiting when failed_streak < agentRetryMax (default 3)', () => {
    // 2 runs, no facts → streak = 2 < 3 → waiting
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'run_001.md', 'run_002.md']
      })
    ).toBe('waiting')
  })

  test('waiting when failed_streak = agentRetryMax - 1', () => {
    // streak = 2 with default agentRetryMax = 3
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'run_001.md', 'run_002.md']
      })
    ).toBe('waiting')
  })
})

// ------- failed -------

describe('deriveNodeState — failed', () => {
  test('failed when failed_streak >= agentRetryMax (default 3)', () => {
    // 3 runs, no facts → streak = 3
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'run_001.md', 'run_002.md', 'run_003.md']
      })
    ).toBe('failed')
  })

  test('failed with custom agentRetryMax=1 and streak=1', () => {
    // 1 run, no fact → streak = 1 >= 1
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'run_001.md'],
        agentRetryMax: 1
      })
    ).toBe('failed')
  })

  test('not failed when streak resets after new fact (streak < threshold)', () => {
    // run_001 failed, fact_001 created (resolved), run_002 failed → streak = 2-1 = 1
    // But fact_001 exists → resolved (checked before failed)
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'run_001.md', 'fact_001.md', 'run_002.md']
      })
    ).not.toBe('failed')
  })
})

// ------- unresolvable -------

describe('deriveNodeState — unresolvable', () => {
  test('unresolvable when unresolvable.md exists and no fact', () => {
    expect(stateFrom({ files: ['task.md', 'a.md', 'unresolvable.md'] })).toBe('unresolvable')
  })

  test('unresolvable takes precedence over a.md waiting', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'run_001.md', 'unresolvable.md']
      })
    ).toBe('unresolvable')
  })
})

// ------- running -------

describe('deriveNodeState — running', () => {
  test('running when running_<pid>_until_<ts> marker file exists', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'running_4821_until_1234567890']
      })
    ).toBe('running')
  })

  test('running when active worktree matches sanitized relPath', () => {
    // relPath = 'my-task', worktree = 'my-task-1234567890'
    expect(
      stateFrom({
        files: ['task.md', 'a.md'],
        activeWorktrees: ['my-task-1234567890'],
        relPath: 'my-task'
      })
    ).toBe('running')
  })

  test('running with nested relPath (cross-level)', () => {
    // relPath = 'research/analyze' → sanitized = 'research-analyze'
    expect(
      stateFrom({
        files: ['task.md', 'a.md'],
        activeWorktrees: ['research-analyze-1234567890'],
        relPath: 'research/analyze'
      })
    ).toBe('running')
  })

  test('not running when worktree name does not match relPath', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md'],
        activeWorktrees: ['other-task-1234567890'],
        relPath: 'my-task'
      })
    ).toBe('waiting')
  })
})

// ------- plan-review -------

describe('deriveNodeState — plan-review', () => {
  test('plan-review for composite plan without approve/reject', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'plan_001.md'],
        fileContents: {
          'plan_001.md': '---\nschema_version: 1\ndecision: composite\n---\n## Children\n'
        }
      })
    ).toBe('plan-review')
  })

  test('not plan-review for atomic plan (decision: atomic)', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'plan_001.md'],
        fileContents: {
          'plan_001.md': '---\nschema_version: 1\ndecision: atomic\n---\n## Approach\n'
        }
      })
    ).toBe('waiting')
  })

  test('not plan-review when composite plan has plan-approved_NNN.md', () => {
    // spawned — needs isComposite; with no child task.md, falls back to null
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'plan_001.md', 'plan-approved_001.md'],
        fileContents: {
          'plan_001.md': '---\nschema_version: 1\ndecision: composite\n---\n'
        }
      })
    ).toBe('waiting') // no children detected (isComposite=false) → not spawned → falls to waiting
  })

  test('plan-review for composite plan even with h.md (human composite)', () => {
    expect(
      stateFrom({
        files: ['task.md', 'h.md', 'plan_001.md'],
        fileContents: {
          'plan_001.md': '---\nschema_version: 1\ndecision: composite\n---\n'
        }
      })
    ).toBe('plan-review')
  })
})

// ------- spawned -------

describe('deriveNodeState — spawned', () => {
  test('spawned when composite plan approved and children exist', () => {
    const state = deriveNodeState('/parent', new Set(), {
      existsSync: p => {
        if (p === '/parent/task.md') return true
        if (p === '/parent/child/task.md') return true
        return false
      },
      readdirSync: d => {
        if (d === '/parent') return ['task.md', 'a.md', 'plan_001.md', 'plan-approved_001.md', 'child']
        return []
      },
      readFileSync: (p, _enc) => {
        if (p === '/parent/plan_001.md') return '---\nschema_version: 1\ndecision: composite\n---\n'
        return ''
      }
    })
    expect(state).toBe('spawned')
  })
})

// ------- pending-audit -------

describe('deriveNodeState — pending-audit', () => {
  test('pending-audit when pending-audit_NNN exists without audit-result', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'fact_001.md', 'pending-audit_001.md']
      })
    ).toBe('pending-audit')
  })

  test('pending-audit only for latest fact NNN', () => {
    // fact_001 has pending-audit, but fact_002 exists without pending-audit → resolved
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'fact_001.md', 'pending-audit_001.md', 'fact_002.md']
      })
    ).toBe('resolved')
  })
})

// ------- resolved -------

describe('deriveNodeState — resolved', () => {
  test('resolved when fact_NNN.md exists without pending-audit', () => {
    expect(stateFrom({ files: ['task.md', 'a.md', 'fact_001.md'] })).toBe('resolved')
  })

  test('resolved when audit-result is success', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'fact_001.md', 'pending-audit_001.md', 'audit-result_001.md'],
        fileContents: {
          'audit-result_001.md': '---\nschema_version: 1\nresult: success\n---\n'
        }
      })
    ).toBe('resolved')
  })

  test('not resolved when audit-result is failed (fact rejected)', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'fact_001.md', 'pending-audit_001.md', 'audit-result_001.md'],
        fileContents: {
          'audit-result_001.md': '---\nschema_version: 1\nresult: failed\n---\n'
        }
      })
    ).toBe('waiting')
  })

  test('resolved takes precedence over unresolvable', () => {
    // resolved > unresolvable per spec priority
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'fact_001.md', 'unresolvable.md']
      })
    ).toBe('resolved')
  })
})

// ------- priority chain -------

describe('deriveNodeState — priority chain', () => {
  test('pending-audit > resolved when open audit cycle on latest fact', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'fact_001.md', 'pending-audit_001.md']
      })
    ).toBe('pending-audit')
  })

  test('resolved > unresolvable', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'fact_001.md', 'unresolvable.md']
      })
    ).toBe('resolved')
  })

  test('unresolvable > running marker', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'running_1_until_9999999999', 'unresolvable.md']
      })
    ).toBe('unresolvable')
  })

  test('running > plan-review', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'plan_001.md', 'running_1_until_9999999999'],
        fileContents: {
          'plan_001.md': '---\nschema_version: 1\ndecision: composite\n---\n'
        }
      })
    ).toBe('running')
  })

  test('plan-review > waiting (a.md)', () => {
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'plan_001.md'],
        fileContents: {
          'plan_001.md': '---\nschema_version: 1\ndecision: composite\n---\n'
        }
      })
    ).toBe('plan-review')
  })

  test('plan-review > pending (h.md)', () => {
    expect(
      stateFrom({
        files: ['task.md', 'h.md', 'plan_001.md'],
        fileContents: {
          'plan_001.md': '---\nschema_version: 1\ndecision: composite\n---\n'
        }
      })
    ).toBe('plan-review')
  })

  test('failed has lowest priority — unresolvable wins', () => {
    // 3 runs (streak=3>=3), but unresolvable.md → unresolvable
    expect(
      stateFrom({
        files: ['task.md', 'a.md', 'run_001.md', 'run_002.md', 'run_003.md', 'unresolvable.md']
      })
    ).toBe('unresolvable')
  })
})
