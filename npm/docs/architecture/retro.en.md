---
type: layered-translation
source: architecture/retro.md
lang: en
sourceFileCrc: a56203cf
authored: false
translated: 2026-07-22
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Meta-cycle: Retrospective Self-Improvement

> Part of the target architecture **0.3.0-draft** — [content](index.md) · [overview](overview.en.md). Implements the meta-cycle [vision](../vision.en.md): the platform offers the executor better solutions based on data that the graph already collects for free.

## Essence

This component implements a retrospective self-improvement cycle that automatically analyzes historical execution data. It identifies systemic failure patterns and proposes specific optimizations addressed directly to the executor. Proposals do not change the graph directly; they serve as a basis for manual implementation, guaranteeing full control. Successfully confirmed changes are recorded as immutable baselines, ensuring a fair measurement of the effect.

## Concept

The graph's audit trail is a ready-made retrospective dataset: `run_NNN` (result, wall_sec, tokens, cost, retry-ladder), plans and their deviations, audit verdicts, `run-summary` of failure patterns. Retro-analysis reads this history and looks for regularities: "tasks of class X with tool Y have a higher failed_streak than with Z," "the 2nd retry ladder on nodes of type W never saves — immediately alternative-approach." A human rarely performs such a retrospective — because it is separate work; here, it is a byproduct of execution.

## Principles (Normative)

1. **Works for the executor.** Proposals are addressed to the executor personally; the cycle is **opt-in** (`retro.enabled`, default `false`). Other roles are not visible to proposals.
2. **Not a surveillance tool.** No personal aggregates for other participants or "executor ratings"; cross-executor analytics are consciously outside 0.3.0.
3. **Proposal ≠ action.** Retro does not change anything in the graph or configs; application is through standard mechanisms (editing `a.md`/`.mt-override.json`/`surface_profiles` by a human, a regular commit/PR).
4. **Data stays within the perimeter.** The analysis is performed by the host, which already has access to the repo; only a push notification "there are proposals" (type 3), without content, is sent via relay.

## Mechanism

- **Trigger:** `retro.schedule_days`, or the threshold of `retro.min_resolved` new resolved nodes, or manually `mt retro`.
- **Execution:** A systemic background run of the agent-server (outside the task graph — the same pattern as the regeneration queue [i18n.md](i18n.en.md)): selection of nodes for the period → LLM analysis (`retro.model_tier`) → proposals.
- **Input:** run/fact/plan/audit-files of nodes, ledger aggregates (cost/wall per sub-tree), current `surface_profiles`/`skill_profiles`/`retry_ladder`.
- **Output — suggestion:**

```yaml
suggestion:
  target: research/analyze          # node or task class (by pattern task.md)
  observed: '3 out of 4 retries ran into lack of web-search'
  proposal: 'retry_ladder step 2: skills_add: [web-search]'
  evidence: [research/analyze/run_002.md, research/collect/run_003.md]
  impact_estimate: '−40% wall_sec on similar tasks'
```

- **Storage:** The executor's private space — `~/.nitra/retro/<period>.md` (outside the task git-repo); proposals **do not** end up in the shared graph.
- **Second output of the same run** — competency aggregator ([mandates.md](mandates.md)): one reader of the run history, two products; no separate competing "history reader" is created.
- **Delivery:** push type 3 ([access.md](access.en.md)) "task X has proposals" → view `mt retro show` or in the UI; each proposal is either accepted (specific config/`a.md` change is generated for review) or rejected with a reason (the reason also enters the next cycle).

## For agent nodes

Proposals regarding agent nodes (`model_tier`, `skills`, `retry_ladder`, surface choice) are addressed to the **task owner**; accepted become regular edits to `a.md`/override-config — the git history shows the evolution of the node's tools. This closes the cross-programmatic dimension ([surfaces.md](surfaces.en.md)): tool selection is driven by data, not just static configuration.

## Innovations: Acceptance and Baseline

The cycle "analysis → proposal → application" is closed by the third link: "application → measurement → recognition." An **accepted** process optimization (from retro, human, or agent) materializes as an immutable file in the root of the graph:

```markdown
# mt/innovation_NNN.md
---
schema_version: 1
created_at: ISO8601
author: vkozlov                # handle of a human | agent-config | retro
scope: 'research/*'            # task class (pattern) or a specific sub-tree
change: 'retry_ladder step 2: skills_add: [web-search]'
baseline:                      # ledger snapshot by scope AT THE MOMENT of acceptance
  runs: 14
  avg_wall_sec: 4100
  avg_cost_usd: 0.61
  failed_streak_rate: 0.35
  evidence: [research/analyze/run_002.md, …]
---
```

The recorded baseline makes future attribution fair: the effect is compared not to memory, but to the recorded snapshot. Privacy is not violated: **proposals are private, implementation is public** — the innovation changes the shared process (commit to the shared repo), so its measurement is public. This is the boundary with the principle of "no surveillance": the change in the process is measured, not the work of the person.

## Impact: Measurement and Incentive

**Measurement** is the second mode of the same retro-run: metrics "after" are compared against the `baseline` for tasks in the `scope`; periodic `impact` snapshots are added to the innovation (append-only):

```yaml
impact:
  period: 2026-07 … 2026-09
  runs: 22                      # confidence: if lower than retro.impact_min_runs — snapshot is not published
  delta_wall_sec: '-38%'
  delta_cost_usd: '-31%'
  delta_failed_streak_rate: '-0.21'
```

**Incentive** — different for humans and agents, from one data source:

- **Humans:** Visible contribution profile — the sum of confirmed effects of the author for the period with evidence links. The platform provides **measurement**, not compensation: bonuses/recognition are team policy based on reliable data (the platform remains neutral).
- **Agents:** Incentive = **selection**. An innovation with a confirmed effect increases the priority of its pattern: better retry ladders/skills become default for the task class; configurations with higher confirmed impact receive more tasks of their class. Evolutionary cycle: what is proven to work is used more widely.

**Anti-gaming:** comparisons only within the task class; `impact_min_runs` as a confidence threshold; disputed snapshots undergo a standard audit mechanism ([graph.md](graph.en.md)). Secondary benefit: `innovation`/`impact` files are a dataset for transferring optimizations between projects.

## Configuration

```jsonc
// .mt.json
{
  "retro": {
    "enabled": false,          // opt-in per-executor
    "schedule_days": 7,
    "min_resolved": 10,        // don't run analysis on an empty period
    "impact_min_runs": 10,     // confidence threshold for impact snapshots
    "model_tier": "AVG"
  }
}
```

## Place in roadmap

MVP is possible immediately after **M0** — dogfood provides the first real run-data, and the analysis requires neither relay nor sessions. The full version (delivery to devices, multi-participants) is after M2. A separate milestone is [roadmap.md](../roadmap.en.md).
