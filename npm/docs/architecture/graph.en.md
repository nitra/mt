---
type: layered-translation
source: architecture/graph.md
lang: en
sourceFileCrc: 0d66e614
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Core: recursive task graph

> Part of the target architecture **0.3.0-draft** — [contents](index.md) · [overview](overview.en.md)

## Essence

This document describes an architectural model that implements a recursive task graph with dynamic scheduling. It defines a clear contract for nodes that can be atomic or composite, ensuring encapsulation and system resilience. The key element is a multi-level state system that manages the lifecycle of tasks from initialization to complete resolution or recognition as unresolvable. This guarantees a transparent and atomic data flow throughout the entire execution process.

## Concept

**Recursive composite DAG** (directed acyclic graph) with dynamic node decomposition and file-based state storage.

### Node

Each node is either atomic or decomposes into a subgraph — the decision is made **dynamically in Stage 1** based on input data.

```
Вузол
  ├── реалізація:
  │     ├── Атомарний  — fn(вхідні) → вихідні
  │     └── Складений  — Граф{ вхід, вузли[], ребра[], виходи[] }
  ├── стан: unassigned | pending | waiting | blocked | plan-review | spawned |
  │         running | stalled | pending-audit | resolved | failed | unresolvable
  ├── вхідні:  Map<portId, Value>
  └── вихідні: Map<portId, Value>   ← заповнюється при resolved
```

For the parent node, the interface is the same: it waits for `resolved` without knowing what is inside (**black-box encapsulation**).

### Graph

- **DAG** — directed, without cycles.
- **Edges** — data flow: outputs of one node become inputs of the next.
- **Topology lives in `deps/`** of each child node. No central graph file: the orchestrator reconstructs the graph by scanning `task.md` and `deps/`.

### Naming convention

- Allowed characters: `a-z`, `0-9`, `-`; separator `-`; uniqueness — among siblings in the parent directory.
- Node `id` = directory name (not duplicated in frontmatter).
- All file/directory names are English; frontmatter attributes are English, snake_case; sections parsed by scripts are English.

## Node file contract

Child nodes live **directly** in the parent directory. A directory contains `task.md` → this is a node.

```
mt/
  <node-id>/
    task.md                  ← місія (immutable після mt init)
    a.md                     ← прапор: виконує агент (model_tier, skills)
    h.md                     ← прапор: виконує людина (assignee, qualification)
    deps/                    ← кожен файл = одна залежність; ім'я = абсолютний dep-id від mt/
    plan_NNN.md              ← Stage 1 output (numbered, immutable)
    plan-approved_NNN.md     ← схвалено; МОЖЕ нести Ed25519-підпис (див. [access.md](access.en.md))
    plan-rejected_NNN.md     ← відхилено з причиною
    running_<pid>_until_<ts> ← git-ignored; локальна observability, НЕ lock
    run-draft.md             ← git-ignored; чернетка агента (Completed/Blockers/Next Attempt)
    run-summary.md           ← mutable; LLM-аналіз патернів невдач
    unresolvable.md          ← термінальний маркер: спроби вичерпано, чекає людину
    run_NNN.md               ← спроба виконавця (+ опційна секція ## Approvals)
    fact_NNN.md              ← успішний результат; NNN = NNN відповідного run
    pending-audit_NNN.md     ← запит аудиту
    audit-result_NNN.md      ← вердикт аудитора; МОЖЕ нести підпис
    clarification_NNN.md     ← запит уточнення від аудитора
    amended_NNN.md           ← виправлена відповідь агента
    history/                 ← аудит-trail: invalidate/kill архіви
    <child-node-id>/         ← дочірній вузол, та сама структура рекурсивно
```

`a.md`/`h.md` are **mutable flags**; they define **who** executes; never both at the same time.

### Invariants

- **Immutable** (after creation): `task.md`, `plan_NNN.md`, `plan-approved/rejected_NNN.md`, `run_NNN.md`, `fact_NNN.md`, `pending-audit_NNN.md`, `clarification_NNN.md`, `amended_NNN.md`, `unresolvable.md`. **Mutable**: `a.md`, `h.md`, `running_*`, `run-draft.md`, `run-summary.md`.
- **`schema_version:`** — the first field of all files with frontmatter. Unknown version → fail closed.
- **Immutability boundary:** before worktree — free; after — only new files. `mt done`/`mt audit` check `task.md`/`a.md`/`h.md` against `origin/main` and reject on diff.
- **`deps/`** mirrors the `mt/` structure; `ls -R deps/` + strip `.md` → dep-ids without reading contents. Relative dep links in `## Children` → `mt spawn` resolves to absolute.
- **Link syntax:** `ref: ../collect-data/fact_001.md`, `…#section`, `… lines 5-20`.

**NNN scale — version chain** (zero-padded, `001`…):

| File | NNN |
| --- | --- |
| `run_NNN.md` | sequential counter (N-th attempt) |
| `fact_NNN.md` | NNN run that created it |
| `pending-audit_NNN.md` | NNN of the corresponding fact |
| `audit-result_NNN.md` / `clarification_NNN.md` | NNN of the corresponding pending-audit |
| `amended_NNN.md` | NNN of the corresponding clarification |

`plan_NNN.md` has separate logic: numbering continues while the node lives; after `mt kill` + re-init → from `001`.

### File schemas

#### `task.md`

```markdown
---
schema_version: 1
created_at: 2026-06-06T10:00:00Z
budget_sec: 600
budget_hard_sec: 10800        # відсутнє → budget_sec × budget_hard_sec_multiplier; 0 → error
budget_total_sec: 14400       # опціонально: сумарний chain-ліміт
progress_timeout_sec: 300     # kill якщо немає mtime-змін у worktree N сек
deadline: 2026-06-12T18:00:00Z # опціонально; сортування черги
audit: optional               # required | optional | off
hint: atomic                  # опціонально: atomic | composite
parent: research/collect-data # відносно mt/; відсутній у кореневого
---

## Task
## Done when
## Check
<!-- кожен непорожній рядок — shell-команда (exit 0) -->
## Inputs
```

Required: `created_at`, `budget_sec`, `## Task`, `## Done when`. `## Check` is run by the wrapper before done/audit; fail → signal rejection. Budget priority: CLI > `plan_NNN.md` > `.mt-override.json` > `task.md` > `.mt.json`.

#### `a.md`

```yaml
schema_version: 1
created_at: ISO8601
model_tier: AVG        # MIM | AVG | MAX; default AVG
skills: [bash, write-files]
secrets: [STRIPE_KEY]  # опціонально; wrapper інжектить через ENV
retry_ladder:          # опціонально; per-node override
  - {}
  - strategy: diagnose-first
interactive: false     # НОВЕ: true → вузол очікує інтерактивну сесію (див. runtime.md)
```

`model_tier` is the executor’s source of truth. With the built-in Claude path, the runner maps it through `.mt.json` `model_map` (MIM/AVG/MAX → Claude model). If `.mt.json` defines `node_executor` (external node executor, [runtime.md](runtime.en.md#зовнішній-екзекутор-вузла-node_executor)), the same tier is passed to the executor as env `MT_MODEL_TIER` — the consumer maps it to its own model pool (the tier canon is mandatory for fix nodes as well). The `a.md` schema does not change: delegation is a global `.mt.json` decision, not a per-node flag.

#### `h.md`

```yaml
schema_version: 1
created_at: ISO8601
assignee: vkozlov          # handle; мапінг на account_id relay — .mt/directory.json (git-ignored)
notify: true               # relay шле push на пристрої assignee
qualification: 'senior backend engineer'
```

#### `plan_NNN.md`

````markdown
---
schema_version: 1
created_at: ISO8601
decision: atomic | composite
budget_sec: 3600            # уточнений (опціонально)
---

## Context
## Approach
## Children

```yaml
children:
  - id: collect-data
    mode: agent             # обов'язково per-child: agent | human
    model_tier: AVG
    skills: [bash, web-search]
    budget_sec: 1800
    export: true            # default; false → не у ## children батьківського fact
    deps: []
    task: |
      Зібрати дані з API
```

## Risks
````

`## Children` is required for `composite`, forbidden for `atomic`. After a composite plan, the node is in `plan-review`.

#### `plan-approved_NNN.md` (CHANGED: optional signature)

```yaml
schema_version: 1
created_at: ISO8601
approved_by:               # опціонально; заповнюється при approve з пристрою
  account_id: <uuid>
  device_id: <uuid>
  signature: <base64 Ed25519 над (node_hash, plan NNN, "approved")>
```

The same block is in `plan-rejected_NNN.md` (with `"rejected"` + `## Reason`) and `audit-result_NNN.md`. Approve from CLI on a trusted machine may have no signature (compatibility); the `require_signed_approvals: true` policy makes the signature mandatory.

#### `fact_NNN.md`

```markdown
---
schema_version: 1
created_at: ISO8601
hash: sha256:<content-addressed: вміст fact + вміст усіх ref-цілей>
---

## Summary
Одне речення (обов'язково).

## <port-name>
ref: data/anomalies.json
```

**Composite parent:** the wrapper adds `## children` — `ref:` to the current fact of each child (except `export: false`).

#### `run_NNN.md` (CHANGED: `handoff` in result, `## Approvals` section, session archive)

`result` enum: `success | failed | progress-timeout | budget-exceeded | claim-lost | merge-conflict | decomposed | handoff`

| Category | Values | `fact_NNN.md` | `failed_streak` |
| --- | --- | --- | --- |
| Terminal success | `success` | created | reset |
| Execution failure | `failed`, `progress-timeout`, `budget-exceeded`, `merge-conflict` | no | +1 |
| Lifecycle | `decomposed`, `claim-lost`, `handoff` | no | unchanged |

```markdown
---
schema_version: 1
created_at: ISO8601
actor: agent | engineer | human | wrapper
result: success
wall_sec: 4200
tokens_in: 184200
tokens_out: 12400
cost_usd: 0.84
worktree: .worktrees/<node-hash>-<token>   # failure — для debug
session_archive: refs/mt/archive/<node-hash>/<NNN>  # НОВЕ, опціонально: повний session.jsonl
---

## Reasoning
## Completed   ← обов'язково при failure
## Blockers    ← обов'язково при failure
## Next Attempt ← обов'язково при failure

## Approvals   ← НОВЕ, опціонально: mid-run підписані approvals
<!-- один рядок YAML на approval -->
- { request_id: <uuid>, action: "edit_file config/prod.yml", approved: true,
    account_id: <uuid>, device_id: <uuid>, signature: <base64>, ts: ISO8601 }

## Script
exit_code: 0

## Ref
ref: fact_001.md   ← при success
```

The source of sections on failure is the agent’s `run-draft.md`; fallback is wrapper telemetry.

#### Audit files

- **`pending-audit_NNN.md`** — `{ schema_version, created_at, actor }`.
- **`audit-result_NNN.md`** — written exclusively by the auditor; `{ …, actor: auditor, result: success | failed }` + `## Reasoning` + optional `approved_by` signature. `failed` → node to `waiting` (rework, run N+1).
- **`clarification_NNN.md`** — clarification request, not a verdict; only once. Timeout `clarification_timeout_sec` without `amended_NNN.md` → auto `audit-result: failed`.
- **`run-summary.md`** — generated by the wrapper (LLM) after `run_summary_threshold` failure runs; deleted on `mt invalidate`/`mt kill`.
- **`history/`** — does not contain `task.md` → scan ignores it. Global kill archive: `<tasks-root>/.history/<ts>-kill-<path>/`.

## Node States

The state is **derived**: lifecycle from node artifacts, runtime ownership from remote claim refs.

| Condition | State |
| :--- | :--- |
| `task.md` exists, `a.md`/`h.md` does not | `unassigned` |
| `h.md` exists, no accepted fact, no active claim | `pending` |
| `a.md` exists, deps resolved, no active claim/fact, `failed_streak < agent_retry_max` | `waiting` |
| `a.md` exists, deps NOT resolved | `blocked` |
| active claim, `lease_until > now()` | `running` |
| claim exists, `lease_until + claim_grace_sec ≤ now()` | `stalled` |
| composite plan without approve/reject | `plan-review` |
| composite approved, not all children resolved | `spawned` |
| `pending-audit_N` exists, `audit-result_N` does not | `pending-audit` |
| an accepted fact exists | `resolved` |
| `unresolvable.md` exists | `unresolvable` |
| `failed_streak ≥ agent_retry_max`, no active claim | `failed` |

Priority: `pending-audit` > `resolved` > `unresolvable` > `stalled` > `running` > `plan-review` > `spawned` > `waiting`/`blocked` > `pending` > `unassigned` > `failed`.

- **Accepted fact** — the current `fact_N` (max NNN) without `pending-audit_N` or with `audit-result_N: success`.
- **`failed_streak`** — count(run with result ∈ execution-failure and NNN > last accepted fact). `decomposed`/`claim-lost`/`handoff` do not count.
- **`audit_failed_streak`** — a separate counter of consecutive rejected audits; ≥ `audit_retry_max` → escalation to human.
- **Deps satisfaction:** dep must be `resolved`; dep with open audit → `blocked`; dep without fact → `blocked-invalid-dep` (warning).
- **Composite:** the state is determined by the atomic one; when all children are resolved, the wrapper writes a synthetic `run`/`fact` pair (actor: wrapper) — recursively upwards.

## Agent Context

Every node run is an agent execution: behavior protocol — `.mt/system-prompt.md`, node files — mission and data:

```
context = [task.md] + [a.md|h.md] + [deps/] + [plan_*.md] +
          [Summary of Prior attempts] + [run-summary.md if exists] + [audit-result_*.md]
```

**Summary of Prior attempts** — two layers of failure compression: the wrapper compacts all failure occurrences into a summary (Completed/Blockers/Next Attempt); after `run_summary_threshold` failure occurrences — an additional `run-summary.md` (LLM summary, second layer). During operation, the agent maintains `run-draft.md`; upon completion, the wrapper moves sections to `run_NNN.md`.

## Two Stages of Execution

**Stage 1 — Planning.** Agent: inline phase `mt run` (writes `plan_NNN.md` as the first phase). Human or forced replanning: explicit `mt plan`. Output: **atomic** → Stage 2 immediately (same run/claim/worktree); **composite** → `plan-review` → `mt spawn --approve` → children.

**Stage 2 — Execution.**

```
agent executes → writes fact_NNN.md →
  mt done   ← confident → ## Check → fenced publish
  mt audit  ← wants review → pending-audit_NNN.md → publish
  mt failed ← failure → run_NNN.md (failed)
```

**Spawn protocol:** `mt spawn --approve` validates `## Children` (naming, mode per-child, deps exist, no cycles), materializes children, commits `plan-approved_NNN.md` + children files **in a single fenced atomic commit**. The node is legitimate ↔ its id in the parent's approved plan in `## Children` or is the root; other directories with `task.md` → `orphan-node` warning. **Dynamic decomposition** during Stage 2: the agent writes `plan_NNN+1.md` (composite) → `result: decomposed` → `plan-review`.

**Node Patch protocol:** `mt stop` successors (from lists) → `mt invalidate <target>` → patch → fenced publish → runner picks up descendants. `mt invalidate` archives the version chain in `history/`; after re-run, compares the new fact hash: same → descendants unblock; different → cascade invalidate downwards. `mt kill` — only final removal of the subtree from topology.

## Retry Ladder, Engineer, Unresolvable

Until `agent_retry_max` (3) the node remains `waiting`; the agent retries according to the ladder (`MT_ATTEMPT` = failed_streak + 1): 1 — base; 2 — diagnose-first; 3 — alternative-approach (`model_tier: +1`, `skills_add`). A shorter ladder → the last rung is repeated.

**EngineerAgent:** `failed_streak ≥ agent_retry_max` → `mt run --actor engineer`: receives task + deps + full run-history + `.mt/engineer-prompt.md`; can perform `mt stop`/`invalidate`/`kill`/GraphPatch.

**Unresolvable:** (1) streak ≥ `agent_retry_max + engineer_retry_max`; (2) `plan-rejected` ≥ `plan_reject_max`; (3) `sum(wall_sec) > budget_total_sec` → `unresolvable.md` + alert (relay push to owner). Output — human: `mt invalidate` (+ task.md edit), `mt kill`, or `mt run <ancestor> --actor engineer`.

## Audit (async queue)

Blocking gate: a node with an open audit = `pending-audit`; dependents wait. Triggers: `mt audit`, `audit_schedule_days`, `audit_on_patch`.

```
agent: fact_NNN.md → mt audit → pending-audit_NNN.md → fenced publish
watch → mt run --actor auditor:
  success → audit-result (success) → resolved
  failed  → audit-result (failed)  → waiting (rework, run N+1)
  clarification (not verdict) → agent --amend → amended → re-audit → final verdict
```

The auditor can be an agent (`audit_model`) **or a human with the `approver+` role** — in which case the verdict is sent signed via relay (see [access.md](access.en.md)), and the host materializes `audit-result_NNN.md` with a signature block.

## End-to-End Example

Solo developer + analyst. Task: investigate Q4 payment anomalies.

### Part 1 — Autonomous Graph

1. **Initialization.** `mt init quarterly-anomalies --task "Investigate Q4 payment anomalies" --mode agent --budget-sec 3600` → `task.md` + `a.md`; human completes `## Done when` and `## Check`.
2. **Inline-plan → composite.** The Orchestrator sees `waiting` → runner: CAS claim → worktree → the agent writes `plan_001.md` (decision: composite) with three children: `collect-data` (agent), `analyze` (agent, `audit: required`, deps: collect-data), `review-findings` (human, deps: analyze). The run completes `result: decomposed` → the node enters `plan-review`.
3. **Approval.** `mt spawn --approve` validates `## Children` → materializes children + `plan-approved_001.md` in a single fenced commit. Parent → `spawned`.
4. **collect-data — happy path.** claim → inline `plan_001` (atomic) → `fact_001.md` → `mt done` → `## Check` passes → `run_001` (success) → fenced publish → `resolved`.
5. **analyze — retry ladder + audit.** Attempt 1 fails (`run_001` failed, `failed_streak = 1`) → retry `MT_ATTEMPT=2` (diagnose-first) → success: `fact_002.md`; `audit: required` → `pending-audit_002.md`. The auditor is skeptical → `clarification_002.md` → agent `--amend` → `amended_002.md` → re-audit → `audit-result_002.md` (success) → `resolved`. During this time, `review-findings` is **blocked** (dep not resolved — blocking gate).
6. **Human Node.** `review-findings` → `pending` + push assignee → human reviews → `fact_001.md` → `mt done` → `resolved`.
7. **Composite Aggregation.** All children resolved → the wrapper writes a synthetic `run_001`/`fact_001` pair (actor: wrapper) referencing `## children` → parent `resolved`.

### Part 2 — Same in Target View (sessions, devices, languages)

8. **Failed Node Taken in Chat.** Suppose, at step 5, both attempts of `analyze` fail. The analyst on a laptop runs `mt attach mt/quarterly-anomalies/analyze/` — this is a **new run of the same node** ([runtime.md](runtime.en.md)): CAS claim (`interactive: true`), worktree, replay. The contract is unchanged — the graph sees a normal run.
9. **Materialization in Participant's Language.** For the analyst, `lang: uk` — README and task content are materialized in Ukrainian in their worktree ([i18n.md](i18n.en.md)); their note correction is compiled into base before publish.
10. **Handoff.** Handling the data is difficult for a laptop — "move here" on the server: the maintainer completes the turn, writes `run_NNN (result: handoff)`, CAS-delete; the server creates a claim (generation+1), inherits the log ([git.md](git.en.md)). The client-laptop remains connected to the same room.
11. **Signed approval from phone.** The agent wants to perform a destructive step (write to prod-DB) → `ApprovalRequest` → the second participant's phone (role `approver`, **without git access**) displays the diff → Ed25519 signature → a line in the run-file's `## Approvals` ([access.md](access.en.md)).
12. **Completion.** `mt done` → `## Check` → fenced publish; then — steps 5–7 as in Part 1. The graph state in `main` is unchanged from the autonomous passage — sessionality and languages leave no trace in the canonical state.
