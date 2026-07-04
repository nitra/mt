import { describe, expect, test } from 'vitest'
import { NODE_STATES, sanitizeTaskName } from '../core/state.mjs'

// Деривація стану перенесена в Rust (crates/mt-core/src/lib.rs) — її покривають cargo-тести.
// Тут лишилось тільки те, що ще живе в JS: перелік станів і sanitize імен worktree.

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
// ВАЖЛИВО: ці вектори мають збігатися з Rust-тестом `sanitize_vectors` (crates/mt-core/src/lib.rs).

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
