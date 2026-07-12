---
schema_version: 1
created_at: 2026-07-12T07:17:19Z
budget_sec: 10800
hint: atomic
---

## Task

M2, тригер mid-run approval (access.md, перший гейт): деструктивний ToolCall агента (політика — `write_file`; read/list вільні) виконується лише після вердикту approver-а — хост шле `ApprovalRequest` у кімнату, чекає верифікований `ApprovalResponse` (таймаут → відмова, «timeout → хід скасовується» з runtime.md); відмова — це `ToolResult { ok: false }` для агента (він бачить причину і адаптується), не падіння ходу.

## Done when

- agent-core: `GatedTool` — декоратор `Tool` із асинхронним approval-запитом перед `invoke`; deny/timeout → `ToolOutput::failure` без виклику внутрішнього тула; `gate_tools(registry, names, requester)` — обгортання за списком імен політики;
- agent-server: `AppState.sessions`/`approvals` — `Arc` (спільні для runner-фабрики без циклу залежностей); `request_approval` доступний як вільна функція над (sessions, gate);
- фабрика `AgentTurnRunner` отримує контекст кімнати (`node` + `workdir`) — requester привʼязаний до правильної кімнати;
- agent-cli serve: `write_file` агентів гейтований (approve-таймаут 120s);
- тести: unit GatedTool (approve → виконується; deny → failure, внутрішній не викликаний); інтеграційний WS+graph: скриптований `write_file` → `ApprovalRequest` у стрічці → approve → `ToolResult ok` і файл у worktree; deny → `ToolResult { ok: false }` із «відхилено»;
- `cargo test --workspace` зелений; без tauri.

## Check

cargo test -p agent-core -p agent-server -q

## Inputs

- Нормативні: access.md (mid-run tool approval; WaitingApproval; timeout-політика per-node), surfaces.md (ефективний набір тулів — перетин політик).
- Побудовано на: ApprovalGate (PR #36), матеріалізація ## Approvals (PR #37), fs_tools/AgentTurnRunner (PR #32).
- Поза скоупом: конфігурована політика списку тулів із `.mt.json`/skill_profiles (скаффолд — write_file), diff-превʼю правки в ApprovalRequest.diff (потребує dry-run тулів).
