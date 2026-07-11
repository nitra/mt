---
schema_version: 1
created_at: 2026-07-11T17:12:52Z
budget_sec: 7200
hint: atomic
---

## Task

Два M1-хвости: (1) `## Check`-гейт перед done інтерактивного run — через `mt_core::signal::run_check` у worktree, невдача → відмова сигналу, run лишається живим для виправлення (контракт graph.md: «## Check ганяється wrapper-ом перед done/audit; fail → відмова сигналу»); (2) файлові тули агента (`read_file`/`write_file`/`list_files`), піскованi до worktree run-а — щоб LLM-агент реально правив файли вузла.

## Done when

- `InteractiveRun::done`: перед publish ганяє `## Check` вузла у worktree (cwd = корінь worktree); ненульовий exit → `Err` з виводом, publish не відбувається, claim/worktree лишаються;
- ws `DoneSession`: run НЕ прибирається з мапи при відмові Check (повторний done після виправлення можливий); прибирається при published або fenced;
- `agent-core`: модуль `fs_tools` — read/write/list зі schemars-схемами; шлях лише відносний, `..`/абсолютний → явна відмова (sandbox-межа worktree);
- `AgentTurnRunner`: фабрика агента отримує workdir run-а — агент кімнати з graph-мостом отримує тули, пісковані до свого worktree;
- тести: escape-захист шляхів; скриптований tool call `write_file` через AgentTurnRunner створює файл у workdir; done з падаючим Check → відмова + claim живий → після виправлення done проходить;
- `cargo test --workspace` зелений; без tauri.

## Check

cargo test -p agent-core -p agent-server -q
cargo clippy -p agent-core -p agent-server --all-targets -- -D warnings

## Inputs

- mt_core::signal::{check_commands, run_check} — готовий Check-runner (cwd = батько tasks_dir).
- graph.md «task.md» (## Check семантика), surfaces.md (sandbox-стеля вузла — перетин формує викликач).
- Поза скоупом: bash-тул (потребує sandbox-політики skill_profiles — окрема задача), FileChanged-події з тулів.
