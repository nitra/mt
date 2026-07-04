/**
 * Vitest global-setup: гарантує наявність Rust-артефактів — CLI-бінарника
 * `mt-scanner` (транзиційний, crates/mt-cli) і napi-аддона `mt` (crates/mt-napi),
 * через які працюють scanner.mjs / native.mjs. Резолвери знаходять їх через
 * dev-fallback у <repoRoot>/target/release; на чистому checkout збираємо.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { platform } from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Збирає mt-scanner і mt-napi (release), якщо артефактів ще немає.
 * @returns {void}
 */
export default function setup() {
  // npm/lib/tests → up 3 = корінь репо
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const bin = join(repoRoot, 'target', 'release', 'mt-scanner')
  const addon = join(repoRoot, 'target', 'release', platform === 'darwin' ? 'libmt_napi.dylib' : 'libmt_napi.so')
  if (!existsSync(bin) || !existsSync(addon)) {
    execFileSync('cargo', ['build', '--release', '-p', 'mt-cli', '-p', 'mt-napi'], {
      cwd: repoRoot,
      stdio: 'inherit'
    })
  }
}
