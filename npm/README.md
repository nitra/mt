# @7n/mt

Standalone Meta-task CLI for task orchestration in multi-agent development workflows.

## Installation

```bash
npm install @7n/mt
# або
bun add @7n/mt
```

## Usage

```bash
mt setup                         # Ініціалізувати mt в проекті (.mt.json, mt/)
mt init <name>                   # Створити нову задачу
mt plan <name>                   # Спланувати задачу
mt verify                        # Перевірити задачу з її директорії
mt status [name] [--json]        # Показати статус задач
mt run <name>                    # Запустити задачу
mt scan                          # Сканувати і синхронізувати стан
mt watch                         # Спостерігати за змінами задач
mt audit <name>                  # Контроль готовності задачі
mt done <name>                   # Позначити як завершену
mt failed <name>                 # Позначити як невдалу
mt spawn <name>                  # Породити дочірню задачу
mt invalidate <name>             # Інвалідувати задачу
mt kill <name>                   # Зупинити виконання задачі
```

## Configuration

`mt` reads `.mt.json` at the project root. Default `mt_dir` is `./mt`.

```json
{ "mt_dir": "./mt" }
```

## License

ISC
