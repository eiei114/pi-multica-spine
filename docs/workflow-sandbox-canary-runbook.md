# Workflow Sandbox Canary Runbook

This runbook covers the repo-local `scripts/workflow-sandbox-canary.mjs` harness for the Idea-to-Build sandbox campaign.

## Modes

- `--dry-run` — print target sandbox path, delivery policy, fixture list, and final package layout. No Multica mutations.
- `--apply` — create sandbox project resources, binding, parent issue, and start a canary run. Rejects explicit production project IDs.
- `--campaign` — drive the full Hermes stage chain from existing canary state (issue seeding, artifact production, controller ticks). Requires prior `--apply`.
- `--human-review` — approve (or reject) the completed canary run, sync parent metadata, close parent issue, and write `10-human-final-review.md`. Requires prior `--campaign` with `workflow_status=completed`.
- `--resume <workflow-run-id>` — resume an existing canary run from ledger state.
- `--fixture <name>` — execute one failure fixture in isolation (`F1_success_path` … `F8_stage_starvation`).
- `--report` — regenerate the final package from existing evidence without live side effects.

## Typical flow

```bash
node scripts/workflow-sandbox-canary.mjs --dry-run
node scripts/workflow-sandbox-canary.mjs --apply
node scripts/workflow-sandbox-canary.mjs --campaign
node scripts/workflow-sandbox-canary.mjs --human-review
node scripts/workflow-sandbox-canary.mjs --report
```

## Safety checks

1. Confirm the sandbox path is under `C:/Users/Keisu/Projects/Sandbox/`.
2. Verify `deliveryPolicy.productionAllowed=false` and `releaseAllowed=false`.
3. Do not pass production project IDs to `--apply`.
4. Record live IDs only in investigation docs; never commit webhook tokens.

## Operations handoff

1. Locate the parent Workflow Issue and open the Workflow Run Ledger.
2. Read `currentStageId`, `migration.status`, and the latest `routeDecisions` entry.
3. Refresh telemetry snapshots when `refresh_telemetry` is the last controller action.
4. Run adapter migration dry-run before any apply.
5. Use migration rollback when `migration.status=preparing`.
6. Keep unresolved preferences in `07-assumptions-and-open-questions.md`.
