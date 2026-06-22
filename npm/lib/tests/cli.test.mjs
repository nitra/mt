import { afterEach, describe, expect, test, vi } from 'vitest'
import { COMMAND_NAMES, runMtCli } from '../cli.mjs'

describe('runMtCli', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('exposes the complete public command surface', () => {
    expect(COMMAND_NAMES).toEqual([
      'setup',
      'init',
      'plan',
      'verify',
      'run',
      'status',
      'scan',
      'watch',
      'audit',
      'done',
      'failed',
      'spawn',
      'invalidate',
      'kill',
      'worktree'
    ])
  })

  test('routes a command and forwards remaining argv', async () => {
    const plan = vi.fn(() => 0)
    expect(await runMtCli(['plan', 'release'], { handlers: { plan } })).toBe(0)
    expect(plan).toHaveBeenCalledWith(['release'], expect.any(Object))
  })

  test('passes --root as handler cwd without leaking it into command args', async () => {
    const setup = vi.fn(() => 0)
    expect(await runMtCli(['setup', '--root', '/workspace/mt-project'], { handlers: { setup } })).toBe(0)
    expect(setup).toHaveBeenCalledWith([], expect.objectContaining({ cwd: '/workspace/mt-project' }))
  })

  test('returns 1 for an unknown command', async () => {
    const error = vi.spyOn(console, 'error').mockReturnValue()
    expect(await runMtCli(['graph'])).toBe(1)
    expect(error).toHaveBeenCalledWith('Невідома команда: graph')
  })
})
