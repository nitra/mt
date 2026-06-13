---
session: df66316d-5f33-46ff-9915-5ff3c75291de
captured: 2026-06-13T07:17:23+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-mt/df66316d-5f33-46ff-9915-5ff3c75291de.jsonl
---

## ADR Заміна JS-сканера на виклик Rust-бінарника `mt-scanner`

## Context and Problem Statement
У проєкті існують дві паралельні реалізації однієї логіки сканування задач: бінарник `mt-scanner` (Rust, `scanner/src/`) і `npm/lib/core/scanner.mjs` (чистий Node.js `fs`). JS-код жодним чином не викликав Rust — вони були повністю незалежні. Користувач вирішив, що самостійна JS-реалізація не повинна існувати, натомість npm-код має делегувати сканування Rust-бінарнику.

## Considered Options
* Зберегти дві паралельні реалізації (поточний стан)
* Видалити JS-реалізацію і викликати `mt-scanner` через `spawnSync` + парсинг JSON stdout

Інші варіанти (napi-rs NAPI-аддон, WASM) були згадані асистентом як можливі, але не обирались.

## Decision Outcome
Chosen option: "Видалити JS-реалізацію і викликати `mt-scanner` через `spawnSync`", because користувач явно сформулював вимогу: «потрібно щоб js реалізації не існувало, а вона викликала rust варіант».

Запропонований механізм виклику з transcript:
```js
import { spawnSync } from 'node:child_process'
const bin = process.env.MT_SCANNER_BIN ?? 'mt-scanner'
const r = spawnSync(bin, ['scan', tasksDir], { encoding: 'utf8' })
if (r.status !== 0) throw new Error(`mt-scanner failed: ${r.stderr}`)
return JSON.parse(r.stdout)
```

### Consequences
* Good, because transcript фіксує очікувану користь: одна канонічна реалізація сканування замість двох паралельних, що дивергували.
* Bad, because на момент завершення transcript стратегія доставки бінарника (`target/` у `.gitignore`, platform-specific shipping) залишилась невирішеною; тести (`npm/lib/tests/*.test.mjs`), що використовують ін'єкцію `fs`-моку через `scanner.mjs`, потребують переписування або видалення.

## More Information
- Rust-сканер: `scanner/src/main.rs`, `scanner/src/lib.rs`, `scanner/Cargo.toml`; бінарник збирається: `cargo build --release --manifest-path scanner/Cargo.toml`
- JS-сканер: `npm/lib/core/scanner.mjs`; експортує `findTasks`, `scanTasks`, `getActiveWorktrees`, `parseWorktreeList`, `areDepsResolved`, `topoSort`, `deriveNodeState`
- Споживачі: `npm/lib/commands/scan.mjs`, `npm/lib/commands/run.mjs`, `npm/index.js`
- CLI Rust: `mt-scanner scan <tasks_dir>` → JSON array; `mt-scanner workspaces [<dir>]` → JSON
- `target/` виключено з git (ADR `20260609-070002`), тобто готового бінарника в репо немає
