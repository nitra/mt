import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { loadNative, resolveNativeAddon } from '../core/native.mjs'

const NO_BUILD_RE = /немає збірки для "linux-arm64"/

describe('resolveNativeAddon', () => {
  test('MT_NATIVE_ADDON override wins over everything', () => {
    const p = resolveNativeAddon({
      env: { MT_NATIVE_ADDON: '/custom/mt.node' },
      platform: 'linux',
      arch: 'x64',
      requireResolve: () => '/should/not/be/used',
      existsSync: () => true
    })
    expect(p).toBe('/custom/mt.node')
  })

  test('resolves platform subpackage napi artifact when installed', () => {
    const p = resolveNativeAddon({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      requireResolve: id => {
        expect(id).toBe('@7n/mt-darwin-arm64/mt.darwin-arm64.node')
        return '/node_modules/@7n/mt-darwin-arm64/mt.darwin-arm64.node'
      },
      existsSync: () => false
    })
    expect(p).toBe('/node_modules/@7n/mt-darwin-arm64/mt.darwin-arm64.node')
  })

  test('linux-x64 maps to the gnu napi suffix', () => {
    const ids = []
    resolveNativeAddon({
      env: {},
      platform: 'linux',
      arch: 'x64',
      requireResolve: id => {
        ids.push(id)
        throw new Error('not installed')
      },
      existsSync: p => p === '/repo/target/release/libmt_napi.so',
      repoRoot: '/repo'
    })
    expect(ids).toContain('@7n/mt-linux-x64/mt.linux-x64-gnu.node')
  })

  test('dev fallback to target/release cdylib when subpackage missing', () => {
    const p = resolveNativeAddon({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      requireResolve: () => {
        throw new Error('not installed')
      },
      existsSync: p2 => p2 === '/repo/target/release/libmt_napi.dylib',
      repoRoot: '/repo'
    })
    expect(p).toBe('/repo/target/release/libmt_napi.dylib')
  })

  test('dev fallback to target/debug when release missing', () => {
    const p = resolveNativeAddon({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      requireResolve: () => {
        throw new Error('not installed')
      },
      existsSync: p2 => p2 === '/repo/target/debug/libmt_napi.dylib',
      repoRoot: '/repo'
    })
    expect(p).toBe('/repo/target/debug/libmt_napi.dylib')
  })

  test('dev fallback to napi build output in crates/mt-napi', () => {
    const p = resolveNativeAddon({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      requireResolve: () => {
        throw new Error('not installed')
      },
      existsSync: p2 => p2 === '/repo/crates/mt-napi/mt.darwin-arm64.node',
      repoRoot: '/repo'
    })
    expect(p).toBe('/repo/crates/mt-napi/mt.darwin-arm64.node')
  })

  test('throws a helpful error when nothing resolves', () => {
    expect(() =>
      resolveNativeAddon({
        env: {},
        platform: 'linux',
        arch: 'arm64',
        requireResolve: () => {
          throw new Error('not installed')
        },
        existsSync: () => false,
        repoRoot: '/repo'
      })
    ).toThrow(NO_BUILD_RE)
  })
})

describe('loadNative (integration, real addon)', () => {
  /** @type {string} */
  let tmp

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'mt-native-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  test('scanTasks returns the node tree from the napi addon', () => {
    const native = loadNative()
    mkdirSync(join(tmp, 'mt/demo'), { recursive: true })
    writeFileSync(join(tmp, 'mt/demo/task.md'), '')
    writeFileSync(join(tmp, 'mt/demo/a.md'), '')

    const nodes = native.scanTasks(join(tmp, 'mt'), [])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].path).toBe('demo')
    expect(nodes[0].state).toBe('waiting')
  })

  test('createTask writes a node and is idempotent', () => {
    const native = loadNative()
    mkdirSync(join(tmp, 'mt'), { recursive: true })

    const first = native.createTask(join(tmp, 'mt'), 'demo', { mode: 'human' })
    expect(first.created).toBe(true)
    expect(first.flag).toBe('h.md')

    const again = native.createTask(join(tmp, 'mt'), 'demo', null)
    expect(again.created).toBe(false)
    expect(again.reason).toBe('exists')
  })
})
