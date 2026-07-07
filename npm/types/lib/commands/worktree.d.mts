/**
 * Точка входу команди `mt worktree`.
 * @param {string[]} args аргументи після `worktree`
 * @param {object} [deps] ін'єкції (cwd/log/config/fs/execSync) для тестів
 * @returns {number} exit code
 */
export default function worktree(args: string[], deps?: object): number
/**
 * `mt worktree create|remove|list|prune|inventory` — developer git-worktree lifecycle.
 *
 * Конвенція (правильно та ефективно): checkout у `<worktrees_dir>/<sanitize_branch(branch)>/`,
 * інвентар — окремо в `<worktrees_dir>/.meta/<sanitized>.md`, тож `<worktrees_dir>/` містить
 * лише worktree-каталоги (+ `.meta/`). Worktree **ефемерний**: `remove` прибирає і checkout,
 * і git-гілку. sanitizeBranch — синхронізовано з Rust `sanitize_branch` у crates/mt-core/src/lib.rs.
 */
export type WorktreeCtx = {
  /**
   * корінь репо
   */
  root: string
  /**
   * абсолютний шлях до worktrees_dir
   */
  worktreesDir: string
  /**
   * логер
   */
  log: (s: string) => void
  /**
   * git-виклик
   */
  execSyncFn: (cmd: string, opts?: object) => string
  /**
   * перевірка існування шляху
   */
  exists: (p: string) => boolean
  /**
   * запис файлу
   */
  writeFile: (p: string, c: string) => void
  /**
   * читання файлу
   */
  readFile: (p: string, enc?: string) => string
  /**
   * лістинг каталогу
   */
  readdir: (d: string) => string[]
  /**
   * видалення
   */
  rmFile: (p: string) => void
  /**
   * mkdir
   */
  mkdirFn: (p: string, o?: object) => void
}
