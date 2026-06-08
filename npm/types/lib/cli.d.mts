/**
 * Запускає mt CLI: парсить argv, маршрутизує до обробника команди.
 * @param {string[]} argv аргументи командного рядка (без node/script)
 * @param {{ handlers?: object, version?: string }} [deps] ін'єкції (handlers, version)
 * @returns {Promise<number>} exit code (0=OK, 1=помилка)
 */
export function runMtCli(argv: string[], deps?: {
    handlers?: object;
    version?: string;
}): Promise<number>;
export const COMMAND_NAMES: string[];
export namespace DEFAULT_HANDLERS {
    function setup(): Promise<typeof import("./commands/setup.mjs").default>;
    function init(): Promise<typeof import("./commands/init.mjs").default>;
    function plan(): Promise<typeof import("./commands/plan.mjs").default>;
    function verify(): Promise<typeof import("./commands/verify.mjs").default>;
    function run(): Promise<typeof import("./commands/run.mjs").default>;
    function status(): Promise<typeof import("./commands/status.mjs").default>;
    function scan(): Promise<typeof import("./commands/scan.mjs").default>;
    function watch(): Promise<typeof import("./commands/watch.mjs").default>;
    function audit(): Promise<typeof import("./commands/audit.mjs").default>;
    function done(): Promise<typeof import("./commands/done.mjs").default>;
    function failed(): Promise<typeof import("./commands/failed.mjs").default>;
    function spawn(): Promise<typeof import("./commands/spawn.mjs").default>;
    function invalidate(): Promise<typeof import("./commands/invalidate.mjs").default>;
    function kill(): Promise<typeof import("./commands/kill.mjs").default>;
}
