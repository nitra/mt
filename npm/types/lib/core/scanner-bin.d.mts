/**
 * Резолвить абсолютний шлях до бінарника `mt-scanner`.
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: string,
 *   arch?: string,
 *   existsSync?: (p: string) => boolean,
 *   requireResolve?: (id: string) => string,
 *   repoRoot?: string
 * }} [deps] ін'єкції для тестів
 * @returns {string} шлях до виконуваного бінарника
 */
export function resolveScannerBin(deps?: {
    env?: Record<string, string | undefined>;
    platform?: string;
    arch?: string;
    existsSync?: (p: string) => boolean;
    requireResolve?: (id: string) => string;
    repoRoot?: string;
}): string;
/**
 * Кешований резолвер (один пошук на процес). Override через resolveScannerBin для тестів.
 * @returns {string} шлях до бінарника
 */
export function scannerBin(): string;
