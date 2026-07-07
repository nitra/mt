export const COMMAND_NAMES = [
  'setup',
  'init',
  'plan',
  'verify',
  'run',
  'status',
  'scan',
  'watch',
  'audit',
  'done',
  'failed',
  'spawn',
  'invalidate',
  'kill',
  'worktree'
]

// Lazy loaders for dynamic imports
const LAZY_HANDLERS = {
  setup: () => import('./commands/setup.mjs'),
  init: () => import('./commands/init.mjs'),
  plan: () => import('./commands/plan.mjs'),
  verify: () => import('./commands/verify.mjs'),
  run: () => import('./commands/run.mjs'),
  status: () => import('./commands/status.mjs'),
  scan: () => import('./commands/scan.mjs'),
  watch: () => import('./commands/watch.mjs'),
  audit: () => import('./commands/audit.mjs'),
  done: () => import('./commands/done.mjs'),
  failed: () => import('./commands/failed.mjs'),
  spawn: () => import('./commands/spawn.mjs'),
  invalidate: () => import('./commands/invalidate.mjs'),
  kill: () => import('./commands/kill.mjs'),
  worktree: () => import('./commands/worktree.mjs')
}

// Wrapper to normalize handlers
export const DEFAULT_HANDLERS = new Proxy(LAZY_HANDLERS, {
  get(target, prop) {
    if (typeof prop !== 'string') return target[prop]
    if (!Object.hasOwn(target, prop)) return
    // Return wrapped lazy loader
    return async (args, deps) => {
      const commandModule = await target[prop]()
      return commandModule.default(args, deps)
    }
  }
})

const HELP_TEXT = `mt — Meta-task CLI

Usage:
  mt <command> [options]

Commands:
  setup       Ініціалізувати mt в проекті
  init        Створити нову задачу
  plan        Спланувати задачу
  verify      Перевірити задачу
  run         Запустити задачу
  status      Показати статус задач
  scan        Сканувати проект
  watch       Спостерігати за задачами
  audit       Контролювати задачі
  done        Позначити задачу як завершену
  failed      Позначити задачу як не вдалу
  spawn       Створити нову задачу
  invalidate  Інвалідувати задачу
  kill        Зупинити задачу
  worktree    Керування developer git-worktrees (create|remove|list|prune|inventory)

Options:
  --help      Показати цю довідку
  --version   Показати версію
  --root DIR  Виконати команду в іншому корені проекту
`

/**
 * Відділяє global CLI options від аргументів конкретної команди.
 * @param {string[]} argv сирі CLI аргументи
 * @returns {{ args: string[], cwd?: string, error?: string }} результат парсингу
 */
function parseGlobalOptions(argv) {
  const args = []
  let cwd

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root' || arg === '--cwd') {
      const value = argv[i + 1]
      if (!value) return { args, error: `${arg} потребує шлях` }
      cwd = value
      i++
      continue
    }
    if (arg.startsWith('--root=')) {
      cwd = arg.slice('--root='.length)
      continue
    }
    if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length)
      continue
    }
    args.push(arg)
  }

  return { args, cwd }
}

/**
 * Запускає mt CLI: парсить argv, маршрутизує до обробника команди.
 * @param {string[]} argv аргументи командного рядка (без node/script)
 * @param {{ handlers?: object, version?: string }} [deps] ін'єкції (handlers, version)
 * @returns {Promise<number>} exit code (0=OK, 1=помилка)
 */
export async function runMtCli(argv, deps = {}) {
  const { handlers = DEFAULT_HANDLERS, version = '0.1.0' } = deps

  // Parse flags
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP_TEXT)
    return 0
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(`mt ${version}`)
    return 0
  }

  const parsed = parseGlobalOptions(argv)
  if (parsed.error) {
    console.error(parsed.error)
    return 1
  }

  const [command, ...args] = parsed.args
  const handler = handlers[command]

  if (!handler) {
    console.error(`Невідома команда: ${command}`)
    console.error(`Виконайте "mt --help" для довідки`)
    return 1
  }

  try {
    return await handler(args, { ...deps, cwd: parsed.cwd ?? deps.cwd })
  } catch (error) {
    console.error(`❌ Помилка при виконанні команди "${command}":`, error.message)
    return 1
  }
}
