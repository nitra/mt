import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { createWorktree } from '../core/worktree.mjs'

const createdDirs = []

function createGitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'mt-worktree-'))
  createdDirs.push(root)
  execFileSync('git', ['init', '-q', '--initial-branch=main'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'mt-test@example.test'], { cwd: root })
  execFileSync('git', ['config', 'user.name', 'MT Test'], { cwd: root })
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8')
  execFileSync('git', ['add', 'README.md'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return root
}

afterEach(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  createdDirs.length = 0
})

describe('createWorktree', () => {
  test('створює parent directory і окрему branch, не detached HEAD', () => {
    const root = createGitRepo()
    const result = createWorktree(join(root, '.worktrees'), 'demo-1', root)

    expect(result).not.toBeNull()
    expect(
      execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: result.worktreePath, encoding: 'utf8' }).trim()
    ).toBe('mt/demo-1')
  })
})
