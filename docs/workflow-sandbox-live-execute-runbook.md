# Workflow Sandbox Live Execute Runbook

Live sandbox rehearsal drives real Multica mutations through apply → campaign → human review. Use this runbook when `--execute` is required (not CI).

**Related:** [`workflow-ops-checklist.md`](workflow-ops-checklist.md) · [`workflow-sandbox-canary-runbook.md`](workflow-sandbox-canary-runbook.md) · [`production-gate-decision.md`](production-gate-decision.md)

## Scope

| In scope | Out of scope |
|---|---|
| Sandbox Idea-to-Build canary project | `productionAllowed=true` |
| Full closeout through `final_package` + human review | Secrets / billing changes |
| Evidence capture (JSON + investigation note) | Destructive production cleanup |

## Preconditions

1. `npm run build` (or full `npm run ci` on the candidate commit).
2. `multica` CLI installed and authenticated with a **user** token.
3. Offline gates green:
   ```bash
   npm run check:sandbox-checklist
   npm run check:sandbox-rehearsal
   npm run check:sandbox-evidence
   ```
4. Live preflight:
   ```bash
   npm run check:sandbox-checklist -- --live
   ```
5. Confirm sandbox path is under your Sandbox directory (not production repo).
6. Confirm `deliveryPolicy.productionAllowed=false` in dry-run output.

## Recommended command sequence

### Full closeout (preferred)

```bash
node scripts/workflow-sandbox-rehearsal.mjs --full-closeout --execute
```

On success this runs: preflight → apply → campaign (up to 80 stage cycles) → human review → closeout evidence capture (JSON + investigation note).

### Manual step-by-step

```bash
node scripts/workflow-sandbox-canary.mjs --dry-run
node scripts/workflow-sandbox-canary.mjs --apply
node scripts/workflow-sandbox-canary.mjs --campaign --run-full-campaign --max-stage-cycles 80
node scripts/workflow-sandbox-canary.mjs --human-review
node scripts/workflow-sandbox-closeout-evidence.mjs --capture --canary-path <sandbox-path>
```

### Partial rehearsal (no human review)

```bash
node scripts/workflow-sandbox-rehearsal.mjs --execute
```

Stops after campaign; does not capture closeout evidence.

## Evidence persistence (R-MNT-28)

After live full closeout, `--capture` writes:

| Artifact | Path |
|---|---|
| JSON | `docs/investigations/sandbox-closeout-evidence.latest.json` |
| Latest note | `docs/investigations/sandbox-closeout-evidence.latest.md` |
| Dated note | `docs/investigations/YYYY-MM-DD-sandbox-closeout-evidence-live.md` |

Commit investigation artifacts in a follow-up PR when recording a reference run (never commit tokens).

## Failure matrix

| Symptom | Likely cause | Recovery |
|---|---|---|
| Preflight fails (`dist-lib`) | Missing build | `npm run build`, retry |
| `mat_` / daemon task token error | Stale daemon marker | Remove `.multica/daemon_task_context.json`, retry apply |
| `blocked-project-guard` | Production project id passed | Use sandbox path only; verify dry-run project |
| Campaign stops before `final_package` | Stage starvation / max cycles | Inspect ledger `currentStageId`; increase `--max-stage-cycles`; resume with `--campaign` |
| Human review rejects | Artifacts incomplete | Fix artifacts; re-run `--human-review` after campaign completes |
| Ledger hash mismatch | State drift | Stop; compare ledger + evidence; do not rewrite history |
| Closeout evidence validation fails | Campaign incomplete or review not approved | Finish campaign + human review; re-run `--capture` |
| `multica` auth errors | Expired token | Re-authenticate; retry with `--live` checklist |

## Post-run verification

```bash
npm run check:sandbox-evidence
npm run check:production-gate
cat docs/investigations/sandbox-closeout-evidence.latest.md
```

## Human Gate reminder

- Do **not** set `productionAllowed=true` without explicit approval per [`production-gate-decision.md`](production-gate-decision.md).
- npm publish and GitHub release remain human-owned via Trusted Publishing.
