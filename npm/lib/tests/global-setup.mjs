/**
 * Vitest global-setup: гарантує наявність Rust-бінарника `mt-scanner`, який тепер
 * виконує все сканування (scanner.mjs — лише шим). Резолвер знаходить його через
 * dev-fallback <repoRoot>/target/release/mt-scanner; на чистому checkout збираємо.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Збирає mt-scanner (release), якщо бінарника ще немає.
 * @returns {void}
 */
export default function setup() {
  // npm/lib/tests → up 3 = корінь репо
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const bin = join(repoRoot, 'target', 'release', 'mt-scanner')
  if (!existsSync(bin)) {
    execFileSync(
      'cargo',
      ['build', '--release', '--manifest-path', join(repoRoot, 'scanner', 'Cargo.toml')],
      { stdio: 'inherit' }
    )
  }
}
