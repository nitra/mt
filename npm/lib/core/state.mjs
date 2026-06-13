/**
 * Канонічний перелік станів задачі та утиліта іменування worktree.
 *
 * Деривація стану з файлової системи виконується в Rust-бінарнику `mt-scanner`
 * (див. scanner/src/lib.rs) — JS-реалізації більше немає. Тут лишилось тільки те,
 * що споживає JS поза скануванням: список станів (валідація/відображення) і
 * sanitize для імен worktree (створення worktree в `mt run`).
 */

/** Всі можливі стани задачі відповідно до специфікації. */
export const NODE_STATES = /** @type {const} */ ([
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

/**
 * Санітизує ім'я задачі для використання в назві worktree.
 *
 * ⚠️ Конвенція дублюється в Rust (`sanitize` у scanner/src/lib.rs), який матчить
 * worktree при детекції стану `running`. Обидві мають лишатися синхронними —
 * спільні тест-вектори: 'research/collect data' → 'research-collect-data',
 * 'my-task_01' → 'my-task_01', '' → ''.
 * @param {string} name ім'я задачі (може містити /)
 * @returns {string} санітизоване ім'я ([^a-zA-Z0-9_-] → '-')
 */
export function sanitizeTaskName(name) {
  return name.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
}
