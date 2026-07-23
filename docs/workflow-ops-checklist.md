# Workflow Ops Checklist

Short path to run Multica work through the workflow adapter **without** opening Human Gates.

## Lanes

| Lane | Script | Binding |
|---|---|---|
| Sandbox canary | `scripts/workflow-sandbox-canary.mjs` | Sandbox project only |
| Production run (Maintenance) | `scripts/workflow-production-run.mjs` | Maintenance project; `productionAllowed=false` |

## Preconditions (both lanes)

1. `npm run build` (or `npm run ci`) so `dist/lib` exists for CLI imports.
2. `multica` authenticated with a **user** token.
3. No stale daemon marker — auto-cleared in v0.5.2+; manual: `rm -f .multica/daemon_task_context.json`.
4. Do **not** set `productionAllowed=true` unless a human has approved [`production-gate-decision.md`](production-gate-decision.md).

## Sandbox flow

```bash
node scripts/workflow-sandbox-canary.mjs --dry-run
node scripts/workflow-sandbox-canary.mjs --apply
node scripts/workflow-sandbox-canary.mjs --campaign
node scripts/workflow-sandbox-canary.mjs --human-review
node scripts/workflow-sandbox-canary.mjs --report
```

Details: [`workflow-sandbox-canary-runbook.md`](workflow-sandbox-canary-runbook.md).

## Maintenance production-run flow

```bash
node scripts/workflow-production-binding.mjs --apply   # once per binding change
node scripts/workflow-production-run.mjs --dry-run
node scripts/workflow-production-run.mjs --start
node scripts/workflow-production-run.mjs --campaign
node scripts/workflow-production-run.mjs --human-review
node scripts/workflow-production-run.mjs --report
```

Details: [`workflow-production-run-runbook.md`](workflow-production-run-runbook.md).

## Failure recovery

| Symptom | Action |
|---|---|
| `mat_` / daemon task token error | Delete `.multica/daemon_task_context.json`, retry |
| Missing `dist/lib` import | `npm run build`, retry |
| Campaign stuck mid-stage | Inspect ledger `currentStageId`; resume with `--campaign` / runbook resume flags |
| Human review reject | Fix artifacts; do not force-close parent; re-run review path |
| Ledger hash mismatch | Stop; compare investigation evidence; do not rewrite history silently |

## Evidence

- Sandbox: `docs/investigations/2026-07-23-workflow-sandbox-canary-evidence.md`
- Production run: `docs/investigations/2026-07-24-production-workflow-run-evidence.md`
- Closeout: `docs/investigations/2026-07-24-workflow-adapter-completion-closeout.md`
