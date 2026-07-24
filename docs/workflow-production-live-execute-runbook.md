# Workflow Production Live Execute Runbook

Live Maintenance production rehearsal drives real Multica mutations through start → campaign → human review. Use this runbook when `workflow-production-rehearsal.mjs --execute` is required (not CI).

**Related:** [`workflow-ops-checklist.md`](workflow-ops-checklist.md) · [`workflow-production-run-runbook.md`](workflow-production-run-runbook.md) · [`production-gate-decision.md`](production-gate-decision.md)

## Scope

| In scope | Out of scope |
|---|---|
| Maintenance project (`pi-multica-spine Maintenance`) | `productionAllowed=true` |
| Full closeout through `final_package` + human review | Secrets / billing changes |
| `prRequired=true` binding rehearsal | Destructive production cleanup |
| Gate remains **CLOSED** (`productionAllowed=false`) | npm publish (human-owned) |

## Preconditions

1. Production binding applied once per binding change:
   ```bash
   node scripts/workflow-production-binding.mjs --apply
   ```
2. `npm run build` (or full `npm run ci` on the candidate commit).
3. `multica` CLI installed and authenticated with a **user** token.
4. Offline gates green:
   ```bash
   npm run check:production-rehearsal
   npm run check:production-gate
   ```
5. Repo path matches binding: `C:/Users/Keisu/Projects/OSS/pi-multica-spine` (or pass `--repo-path`).
6. Confirm `deliveryPolicy.productionAllowed=false` in dry-run output.

## Recommended command sequence

### Orchestrated rehearsal (preferred)

```bash
node scripts/workflow-production-rehearsal.mjs --execute
```

On success: preflight → `--start` → `--campaign` (up to 80 stage cycles) → `--human-review`.

### Manual step-by-step

```bash
node scripts/workflow-production-run.mjs --dry-run
node scripts/workflow-production-run.mjs --start
node scripts/workflow-production-run.mjs --campaign --max-stage-cycles 80
node scripts/workflow-production-run.mjs --human-review
node scripts/workflow-production-run.mjs --report
```

## Artifacts

| Location | Notes |
|---|---|
| `Artifacts/workflows/<workflow-run-id>/` | Gitignored workflow artifacts |
| `Artifacts/workflows/<run-id>/final/` | Final package index |
| `.multica-spine/production-run-state.json` | Gitignored CLI state |

Record live IDs in `docs/investigations/` — never commit tokens.

## Failure matrix

| Symptom | Likely cause | Recovery |
|---|---|---|
| Preflight fails (`dist-lib`) | Missing build | `npm run build`, retry |
| `mat_` / daemon task token error | Stale daemon marker | Remove `.multica/daemon_task_context.json`; v0.5.2+ auto-clears on start/campaign/review |
| Binding not applied | Missing Maintenance binding | `node scripts/workflow-production-binding.mjs --apply` |
| Wrong repo path | `--repo-path` drift | Match binding repo path in dry-run |
| Campaign stops before `final_package` | Stage starvation / max cycles | Inspect ledger `currentStageId`; increase `--max-stage-cycles`; resume `--campaign` |
| Human review rejects | Artifacts incomplete | Fix artifacts; re-run `--human-review` after campaign completes |
| Ledger hash mismatch | State drift | Stop; compare investigation evidence; do not rewrite history |
| `production-plan` check fails | Policy drift | Verify `productionAllowed=false`; do not open gate without human approval |
| `multica` auth errors | Expired token | Re-authenticate, retry |

## Post-run verification

```bash
npm run check:production-rehearsal
npm run check:production-gate
```

Compare ledger hash with `docs/investigations/2026-07-24-production-workflow-run-evidence.md` reference pattern.

## Human Gate reminder

- Maintenance rehearsal **does not** require opening the production gate.
- Do **not** set `productionAllowed=true` without explicit approval per [`production-gate-decision.md`](production-gate-decision.md).
- npm publish and GitHub release remain human-owned via Trusted Publishing.
