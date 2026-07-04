/**
 * YAML front-matter parser/serializer для mt task-файлів.
 *
 * Тонка обгортка над Rust-ядром (crates/mt-core/src/frontmatter.rs через
 * napi-аддон). Вихід serializeYaml байт-у-байт ідентичний історичній
 * JS-реалізації (конформанс — vitest-сюїта + Rust-тести serialize_yaml_matches_js_bytes).
 *
 * Підтримує:
 * - Прості `key: value` рядки
 * - Вкладені об'єкти (блок з відступами), напр. `executor:` + indented children
 * - Списки: `deps:` / `skills:` із рядками `  - item`
 * - Серіалізацію назад у YAML (для запису front-matter)
 */
import { loadNative } from './native.mjs'

/**
 * Парсить YAML front-matter з markdown-тексту.
 * Повертає словник (може містити вкладені об'єкти та масиви).
 * @param {string} text вміст файлу
 * @returns {Record<string, unknown>} ключ-значення, або {} якщо front-matter відсутній
 */
export function parseFrontMatter(text) {
  return loadNative().parseFrontMatter(text)
}

/**
 * Отримує тіло документа (без front-matter).
 * @param {string} text вміст файлу
 * @returns {string} тіло без front-matter
 */
export function getBody(text) {
  return loadNative().getBody(text)
}

/**
 * Серіалізує об'єкт у YAML-рядок (для front-matter).
 * Підтримує прості scalar, масиви та вкладені об'єкти.
 * @param {Record<string, unknown>} obj об'єкт для серіалізації
 * @param {number} [indentLevel] рівень відступу (default: 0)
 * @returns {string} YAML-рядок (без --- маркерів)
 */
export function serializeYaml(obj, indentLevel = 0) {
  return loadNative().serializeYaml(obj, indentLevel)
}

/**
 * Будує markdown-файл із front-matter і тілом.
 * @param {Record<string, unknown>} fm об'єкт front-matter
 * @param {string} [body] тіло документа (default: '')
 * @returns {string} повний вміст файлу
 */
export function buildMarkdown(fm, body = '') {
  return loadNative().buildMarkdown(fm, body)
}
