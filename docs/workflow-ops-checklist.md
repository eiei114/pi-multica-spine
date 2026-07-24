# Workflow Ops Checklist

Short path to run Multica work through the workflow adapter **without** opening Human Gates.

## Lanes

| Lane | Script | Binding |
|---|---|---|
| Sandbox canary | `scripts/workflow-sandbox-canary.mjs` | Sandbox project only |
| Production run (Maintenance) | `scripts/workflow-production-run.mjs` | Maintenance project; `productionAllowed=false` |

## Preconditions (both lanes)

0. Optional offline rehearsal: `node examples/workflow-campaign-walkthrough/run-walkthrough.mjs` (no Multica CLI).
0a. **Idea entry (Pi):** `/skill:idea-to-build` then paste rough idea → `node scripts/workflow-idea-entry.mjs --rough-idea "..." --execute`.
0b. Automated preflight: `npm run check:sandbox-checklist` (offline) or `npm run check:sandbox-checklist -- --live` before live sandbox ops.
0c. Rehearsal plan (CI): `npm run check:sandbox-rehearsal` (full closeout). Live: `node scripts/workflow-sandbox-rehearsal.mjs --full-closeout --execute`.
0d. Closeout evidence (CI): `npm run check:sandbox-evidence`. Live capture after full closeout: `node scripts/workflow-sandbox-closeout-evidence.mjs --capture --canary-path <path>` (writes JSON + investigation note).
0e. **Live execute runbook:** [`workflow-sandbox-live-execute-runbook.md`](workflow-sandbox-live-execute-runbook.md).
0f. Maintenance rehearsal (CI): `npm run check:production-rehearsal`. Live: `node scripts/workflow-production-rehearsal.mjs --execute`.
0g. **Production live execute runbook:** [`workflow-production-live-execute-runbook.md`](workflow-production-live-execute-runbook.md).
0h. Production gate checklist (CI): `npm run check:production-gate` — validates prerequisites while gate remains **CLOSED**.
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

For live `--execute` rehearsal (apply → campaign → human review → evidence), see [`workflow-sandbox-live-execute-runbook.md`](workflow-sandbox-live-execute-runbook.md).

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

For live `--execute` rehearsal, see [`workflow-production-live-execute-runbook.md`](workflow-production-live-execute-runbook.md).

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
- Sandbox closeout JSON (live): `docs/investigations/sandbox-closeout-evidence.latest.json`
- Sandbox closeout note (live): `docs/investigations/sandbox-closeout-evidence.latest.md`
- Production run: `docs/investigations/2026-07-24-production-workflow-run-evidence.md`
- Closeout: `docs/investigations/2026-07-24-workflow-adapter-completion-closeout.md`
