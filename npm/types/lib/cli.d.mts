/**
 * Запускає mt CLI: парсить argv, маршрутизує до обробника команди.
 * @param {string[]} argv аргументи командного рядка (без node/script)
 * @param {{ handlers?: object, version?: string }} [deps] ін'єкції (handlers, version)
 * @returns {Promise<number>} exit code (0=OK, 1=помилка)
 */
export function runMtCli(
  argv: string[],
  deps?: {
    handlers?: object
    version?: string
  }
): Promise<number>
export const COMMAND_NAMES: string[]
export namespace DEFAULT_HANDLERS {
  function setup(): Promise<typeof import('./commands/setup.mjs')>
  function init(): Promise<typeof import('./commands/init.mjs')>
  function plan(): Promise<typeof import('./commands/plan.mjs')>
  function verify(): Promise<typeof import('./commands/verify.mjs')>
  function run(): Promise<typeof import('./commands/run.mjs')>
  function status(): Promise<typeof import('./commands/status.mjs')>
  function scan(): Promise<typeof import('./commands/scan.mjs')>
  function watch(): Promise<typeof import('./commands/watch.mjs')>
  function audit(): Promise<typeof import('./commands/audit.mjs')>
  function done(): Promise<typeof import('./commands/done.mjs')>
  function failed(): Promise<typeof import('./commands/failed.mjs')>
  function spawn(): Promise<typeof import('./commands/spawn.mjs')>
  function invalidate(): Promise<typeof import('./commands/invalidate.mjs')>
  function kill(): Promise<typeof import('./commands/kill.mjs')>
  function worktree(): Promise<typeof import('./commands/worktree.mjs')>
}
