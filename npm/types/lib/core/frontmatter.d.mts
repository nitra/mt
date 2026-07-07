/**
 * Парсить YAML front-matter з markdown-тексту.
 * Повертає словник (може містити вкладені об'єкти та масиви).
 * @param {string} text вміст файлу
 * @returns {Record<string, unknown>} ключ-значення, або {} якщо front-matter відсутній
 */
export function parseFrontMatter(text: string): Record<string, unknown>;
/**
 * Отримує тіло документа (без front-matter).
 * @param {string} text вміст файлу
 * @returns {string} тіло без front-matter
 */
export function getBody(text: string): string;
/**
 * Серіалізує об'єкт у YAML-рядок (для front-matter).
 * Підтримує прості scalar, масиви та вкладені об'єкти.
 * @param {Record<string, unknown>} obj об'єкт для серіалізації
 * @param {number} [indentLevel] рівень відступу (default: 0)
 * @returns {string} YAML-рядок (без --- маркерів)
 */
export function serializeYaml(obj: Record<string, unknown>, indentLevel?: number): string;
/**
 * Будує markdown-файл із front-matter і тілом.
 * @param {Record<string, unknown>} fm об'єкт front-matter
 * @param {string} [body] тіло документа (default: '')
 * @returns {string} повний вміст файлу
 */
export function buildMarkdown(fm: Record<string, unknown>, body?: string): string;
