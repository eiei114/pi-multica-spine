# Workflow Idea Entry Live Execute Runbook

Live idea entry creates a local sandbox session from `/skill:idea-to-build` through `capture` only. It does not call Multica before `build_handoff`.

**Related:** [`workflow-ops-checklist.md`](workflow-ops-checklist.md) · [`workflow-sandbox-live-execute-runbook.md`](workflow-sandbox-live-execute-runbook.md) · [`production-gate-decision.md`](production-gate-decision.md)

## Scope

| In scope | Out of scope |
|---|---|
| Human-initiated Idea-to-Build via `workflow-idea-entry.mjs` | `productionAllowed=true` |
| Fresh sandbox session path per idea (default) | Maintenance production-run lane |
| Sandbox apply + initial `capture` stage | Secrets / billing changes |

## Preconditions

1. `npm run build` (or full `npm run ci` on the candidate commit).
2. `multica` CLI installed and authenticated with a **user** token.
3. Offline gates green:
   ```bash
   npm run check:sandbox-checklist
   npm run check:idea-entry
   ```
4. Live preflight (optional):
   ```bash
   npm run check:sandbox-checklist -- --live
   ```
5. Confirm `deliveryPolicy.productionAllowed=false` in dry-run output.

## Recommended command sequence

### Pi slash entry (preferred)

```
/skill:idea-to-build
<paste rough idea>
```

Agent runs:

```bash
npm run build
node scripts/workflow-idea-entry.mjs --rough-idea "<ROUGH_IDEA>" --execute --json
```

This stops after creating the local session manifest and initial `capture` state. Report that stage and wait for explicit human approval before advancing. No Multica Project, parent issue, Controller Autopilot, resource, or Spine binding is permitted before `build_handoff`.

### Project-bound implementation boundary

At `build_handoff`, select an exact-title planned Project when present; otherwise create an implementation Project. Attach implementation resources and bind Work Agent Spine only after that selection. The legacy sandbox canary remains a separate rehearsal harness and is not a product-idea continuation path.

Advance exactly one local stage after each explicit human approval; this command never contacts Multica:

```bash
node scripts/workflow-idea-stage-advance.mjs --canary-path <session-path>
```

After the command reports `currentStageId: "build_handoff"`, run it once more to reach `status: "promotion_ready"`. Inspect the default dry-run, then explicitly promote:

```bash
node scripts/workflow-idea-build-handoff.mjs --canary-path <session-path> --project-title "<EXACT_PROJECT_TITLE>"
node scripts/workflow-idea-build-handoff.mjs --canary-path <session-path> --project-title "<EXACT_PROJECT_TITLE>" --apply
```

`--apply` lists Projects, reuses exactly one exact-title `planned` Project, or creates one. Duplicate planned titles fail closed. It records the selected Project in the local session and prints the mandatory `multica_spine_bind` handoff; perform that bind in the implementation agent session before creating implementation work.

### Plan first (no Multica mutations)

```bash
node scripts/workflow-idea-entry.mjs --rough-idea "<ROUGH_IDEA>" --dry-run --json
```

Inspect `canaryPath` and `freshSession: true` in the JSON — each idea gets a new sandbox working tree under `pi-multica-spine-idea-sessions/` by default.

### Reuse legacy default canary path

Only when intentionally resuming the shared canary repo:

```bash
node scripts/workflow-idea-entry.mjs --rough-idea "<ROUGH_IDEA>" --reuse-default-canary --execute --json
```

## Fresh session paths (R-MNT-38)

| Flag | Behavior |
|---|---|
| *(default)* | Allocates `SANDBOX_SESSIONS_ROOT/<slug>-<timestamp>` |
| `--canary-path <path>` | Explicit session directory |
| `--reuse-default-canary` | Legacy shared path `pi-multica-spine-idea-to-build-canary` |

## Pack smoke (R-MNT-39)

Published tarball smoke includes offline idea-entry dry-run:

```bash
npm run pack:smoke
```

## Failure matrix

| Symptom | Likely cause | Recovery |
|---|---|---|
| `rough idea must be at least 12 characters` | Brief too short | Expand the idea text |
| Preflight fails (`dist-lib`) | Missing build | `npm run build`, retry |
| `mat_` / daemon task token error | Stale daemon marker | Remove `.multica/daemon_task_context.json` in session path |
| Prior parent reused unexpectedly | Used `--reuse-default-canary` or explicit path with state | Omit flags for fresh session; check `freshSession` in dry-run JSON |
| Campaign stops before `final_package` | Stage starvation | Resume with `--campaign` on the session `canaryPath` |

## Evidence

Record sandbox closeout after full campaign + human review per [`workflow-sandbox-live-execute-runbook.md`](workflow-sandbox-live-execute-runbook.md).
