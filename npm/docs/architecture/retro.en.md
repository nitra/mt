---
type: layered-translation
source: architecture/retro.md
lang: en
sourceFileCrc: e1802362
authored: false
translated: 2026-07-12
model: omlx/gemma-4-e4b-it-OptiQ-4bit
---

# Meta-cycle: retrospective self-improvement

> Part of the target architecture **0.3.0-draft** — [content](index.md) · [overview](overview.en.md). Implements the meta-cycle [goal](../vision.en.md): the platform offers the executor better solutions based on data that the graph already tracks for free.

## Essence

This component implements a retrospective self-improvement cycle that automatically analyzes historical execution data. It identifies systemic failure patterns and suggests specific optimizations addressed directly to the executor. The proposals do not change the graph directly but serve as a basis for manual implementation, ensuring full control is maintained. Successfully confirmed changes are recorded as immutable baseline lines, ensuring a fair measurement of the effect.

## Concept

The graph's audit trail is a retrospective dataset: `run_NNN` (result, wall_sec, tokens, cost, retry-scales), plans and their deviations, audit verdicts, and `run-summary` of failure patterns. Retro-analysis reads this history and looks for patterns: "tasks of class X with tool Y have a higher failed\_streak than with Z," "retry ladder scale 2 on nodes of type W never saves — immediately an alternative-approach." A human almost never performs such a retrospective — because it is a separate task; here, it is a byproduct of execution.

## Principles (Normative)

1. **Operates on the executor.** Proposals are addressed to the executor personally; the cycle is **opt-in** (`retro.enabled`, default `false`). Proposals are not visible to other roles.
2. **Not a monitoring tool.** No personal aggregates for other participants or "executor ratings"; cross-executor analytics are deliberately outside 0.3.0.
3. **Proposal $\neq$ Action.** Retro does not change anything in the graph or configs; application is only through standard mechanisms (manual editing of `a.md`/`.mt-override.json`/`surface_profiles` by a human, standard commit/PR).
4. **Data stays within the perimeter.** The host performs the analysis, which already has access to the repo; only a push notification "proposals exist" (type 3) goes via relay, without content.

## Mechanism

- **Trigger:** `retro.schedule_days`, or a threshold of `retro.min_resolved` new resolved nodes, or manually `mt retro`.
- **Execution:** A system background run of the agent-server (outside the task graph — the same pattern as the regeneration queue [i18n.md](i18n.en.md)): selection of nodes for the period $\to$ LLM analysis (`retro.model_tier`) $\to$ proposals.
- **Input:** run/fact/plan/audit files of the nodes, ledger aggregates (cost/wall per subtrees), current `surface_profiles`/`skill_profiles`/`retry_ladder`.
- **Output — suggestion:**

```yaml
suggestion:
  target: research/analyze          # node or task class (based on task.md pattern)
  observed: '3 out of 4 retries hit the lack of web-search'
  proposal: 'retry_ladder scale 2: skills_add: [web-search]'
  evidence: [research/analyze/run_002.md, research/collect/run_003.md]
  impact_estimate: '−40% wall_sec on similar tasks'
```

- **Storage:** private executor space — `~/.nitra/retro/<period>.md` (outside the task git-repo); proposals **do not** enter the shared graph.
- **Delivery:** type 3 push ([access.md](access.en.md)) "task X has proposals" $\to$ viewing `mt retro show` or in the UI; each proposal is either accept (specific config/`a.md` change is generated for review) or reject with a reason (the reason is also input for the next cycle).

## For agent nodes

Proposals regarding agent nodes (`model_tier`, `skills`, `retry_ladder`, surface selection) are addressed to the **task owner**; accepted become standard edits to `a.md`/override config — the git history shows the evolution of the node's tools. This closes the cross-programmatic dimension ([surfaces.md](surfaces.en.md)): tool selection is fueled by data, not just static configuration.

## Innovations: acceptance and baseline

The "analysis $\to$ proposal $\to$ application" cycle closes with the third link: "application $\to$ measurement $\to$ recognition." An **accepted** process optimization (from retro, human, or agent) materializes as an immutable file at the root of the graph:

```markdown
# mt/innovation_NNN.md
---
schema_version: 1
created_at: ISO8601
author: vkozlov                # human handle | agent-config | retro
scope: 'research/*'            # task class (pattern) or specific subtree
change: 'retry_ladder scale 2: skills_add: [web-search]'
baseline:                      # ledger snapshot for the scope AT THE TIME of acceptance
  runs: 14
  avg_wall_sec: 4100
  avg_cost_usd: 0.61
  failed_streak_rate: 0.35
  evidence: [research/analyze/run_002.md, …]
---
```

The recorded baseline makes future attribution fair: the effect is compared not against memory, but against the recorded snapshot. Privacy is not violated: **proposals are private, implementation is public** — the innovation changes the common process (commit to the shared repo), so its measurement is public. This is the boundary with the "non-monitoring" principle: the process change is measured, not the human's work.

## Impact: measurement and incentive

**Measurement** — the second mode of the same retro-run: for tasks in the `scope`, metrics are compared "after" versus the `baseline`; periodic `impact` snapshots are added to the innovation (append-only):

```yaml
impact:
  period: 2026-07 … 2026-09
  runs: 22                      # confidence: if lower than retro.impact_min_runs — the snapshot is not published
  delta_wall_sec: '-38%'
  delta_cost_usd: '-31%'
  delta_failed_streak_rate: '-0.21'
```

**Incentive** — different for humans and agents, from one data source:

- **Humans:** visible contribution profile — sum of confirmed effects of the author for the period with evidence links. The platform provides **measurement**, not compensation: bonuses/recognition are team policy based on reliable data (the platform remains neutral).
- **Agents:** incentive = **selection**. An innovation with a confirmed effect increases the priority of its pattern: better retry ladders/skills become the default for the task class; configurations with a higher confirmed impact receive more tasks of their class. Evolutionary cycle: what is proven to work is used more widely.

**Anti-gaming:** comparison only within the task class; `impact_min_runs` as a confidence threshold; disputed snapshots undergo standard audit mechanism ([graph.md](graph.en.md)). Secondary value: `innovation`/`impact` files — a dataset of optimization portability between projects.

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

MVP is possible immediately after **M0** — dogfood provides the first real run data, and analysis requires neither relay nor sessions. The full version (device delivery, multi-participants) is after M2. A separate milestone is [roadmap.md](../roadmap.en.md).
