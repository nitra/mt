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

const NAME_SEGMENT_RE = /^[a-z0-9-]+$/

/**
 * Валідує id вузла для створення задачі (НЕ виправляє — повертає помилку).
 *
 * ⚠️ Має лишатися синхронною з Rust `validate_name` (scanner/src/lib.rs) — спільні
 * тест-вектори в `npm/lib/tests/fixtures/name-vectors.json`. Правила (docs spec §8):
 * сегменти `[a-z0-9-]+`, роздільник `/`; без порожніх/`.`/`..` сегментів,
 * провідного/кінцевого `/`, великих літер, `_`, пробілів, traversal.
 * @param {string} name id вузла (може містити /)
 * @returns {string | null} текст помилки або null якщо валідне
 */
export function validateTaskName(name) {
  if (!name) return 'name must not be empty'
  if (name.startsWith('/') || name.endsWith('/')) {
    return `name must not start or end with '/': ${JSON.stringify(name)}`
  }
  for (const seg of name.split('/')) {
    if (seg === '') return `name has an empty segment: ${JSON.stringify(name)}`
    if (seg === '.' || seg === '..') {
      return `name segment must not be '.' or '..': ${JSON.stringify(name)}`
    }
    if (!NAME_SEGMENT_RE.test(seg)) {
      return `name segment ${JSON.stringify(seg)} must match [a-z0-9-]: ${JSON.stringify(name)}`
    }
  }
  return null
}
