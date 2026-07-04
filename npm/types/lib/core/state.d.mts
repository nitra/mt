/**
 * Санітизує ім'я задачі для використання в назві worktree.
 *
 * Логіка — Rust `sanitize` (crates/mt-core/src/lib.rs), той самий код, що
 * матчить worktree при детекції стану `running` — розсинхрон неможливий.
 * Тест-вектори: 'research/collect data' → 'research-collect-data',
 * 'my-task_01' → 'my-task_01', '' → ''.
 * @param {string} name ім'я задачі (може містити /)
 * @returns {string} санітизоване ім'я ([^a-zA-Z0-9_-] → '-')
 */
export function sanitizeTaskName(name: string): string;
/**
 * Валідує id вузла для створення задачі (НЕ виправляє — повертає помилку).
 *
 * Логіка — Rust `validate_name` (crates/mt-core/src/lib.rs); спільні
 * тест-вектори в `npm/lib/tests/fixtures/name-vectors.json`. Правила (docs spec §8):
 * сегменти `[a-z0-9-]+`, роздільник `/`; без порожніх/`.`/`..` сегментів,
 * провідного/кінцевого `/`, великих літер, `_`, пробілів, traversal.
 * @param {string} name id вузла (може містити /)
 * @returns {string | null} текст помилки або null якщо валідне
 */
export function validateTaskName(name: string): string | null;
/** Всі можливі стани задачі відповідно до специфікації. */
export const NODE_STATES: readonly ["unassigned", "pending", "waiting", "blocked", "plan-review", "spawned", "running", "stalled", "pending-audit", "resolved", "failed", "unresolvable"];
