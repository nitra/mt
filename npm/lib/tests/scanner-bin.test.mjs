import { describe, expect, test } from 'vitest'

import { resolveScannerBin } from '../core/scanner-bin.mjs'

const NO_PREBUILT_RE = /немає prebuilt-бінарника для "linux-arm64"/

describe('resolveScannerBin', () => {
  test('MT_SCANNER_BIN override wins over everything', () => {
    const bin = resolveScannerBin({
      env: { MT_SCANNER_BIN: '/custom/mt-scanner' },
      platform: 'linux',
      arch: 'x64',
      requireResolve: () => '/should/not/be/used',
      existsSync: () => true
    })
    expect(bin).toBe('/custom/mt-scanner')
  })

  test('resolves platform subpackage when installed', () => {
    const bin = resolveScannerBin({
      env: {},
      platform: 'linux',
      arch: 'x64',
      requireResolve: id => {
        expect(id).toBe('@7n/mt-linux-x64/mt-scanner')
        return '/node_modules/@7n/mt-linux-x64/mt-scanner'
      },
      existsSync: () => false
    })
    expect(bin).toBe('/node_modules/@7n/mt-linux-x64/mt-scanner')
  })

  test('appends .exe on win32 subpackage id', () => {
    const ids = []
    resolveScannerBin({
      env: {},
      platform: 'win32',
      arch: 'x64',
      requireResolve: id => {
        ids.push(id)
        throw new Error('not installed')
      },
      existsSync: p => p.endsWith('mt-scanner.exe') && p.includes('release'),
      repoRoot: '/repo'
    })
    expect(ids).toContain('@7n/mt-win32-x64/mt-scanner.exe')
  })

  test('dev fallback to target/release when subpackage missing', () => {
    const bin = resolveScannerBin({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      requireResolve: () => {
        throw new Error('not installed')
      },
      existsSync: p => p === '/repo/target/release/mt-scanner',
      repoRoot: '/repo'
    })
    expect(bin).toBe('/repo/target/release/mt-scanner')
  })

  test('dev fallback to target/debug when release missing', () => {
    const bin = resolveScannerBin({
      env: {},
      platform: 'darwin',
      arch: 'arm64',
      requireResolve: () => {
        throw new Error('not installed')
      },
      existsSync: p => p === '/repo/target/debug/mt-scanner',
      repoRoot: '/repo'
    })
    expect(bin).toBe('/repo/target/debug/mt-scanner')
  })

  test('throws a helpful error when nothing resolves', () => {
    expect(() =>
      resolveScannerBin({
        env: {},
        platform: 'linux',
        arch: 'arm64',
        requireResolve: () => {
          throw new Error('not installed')
        },
        existsSync: () => false,
        repoRoot: '/repo'
      })
    ).toThrow(NO_PREBUILT_RE)
  })
})
