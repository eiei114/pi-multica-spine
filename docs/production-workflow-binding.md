# Production Workflow Binding

This document describes the **production-tier** Hermes workflow binding for the `pi-multica-spine Maintenance` Multica project.

## Project

| Field | Value |
|---|---|
| Name | `pi-multica-spine Maintenance` |
| ID | `415010b1-f28a-4ae4-9042-ddeb00800029` |
| Repo path | `C:/Users/Keisu/Projects/OSS/pi-multica-spine` |
| Artifact root | `Artifacts/workflows` |

## Policy

| Gate | Value |
|---|---|
| `prRequired` | `true` |
| `releaseAllowed` | `true` (human-owned via `humanOwnedActions`) |
| `productionAllowed` | `false` |
| `destructiveAllowed` | `false` |
| `executionMode` | `autonomous_until_final` |
| `humanGate` | `start_and_final` |

Release, production deploy, secrets, billing, and destructive operations remain **human-owned** even on the production binding.

## Color output policy (resolved)

Canary question **Q1** is resolved as:

- **Default**: JSON output (`scripts/jsonl-digest.mjs` or sandbox `src/digest.mjs`)
- **Human summary**: `--human`
- **Color**: opt-in via `--color`, or automatic on TTY when `--human` unless `--no-color`

Metadata key: `color_output_policy=json_default_opt_in_color`

## Apply

```bash
# Plan only
node scripts/workflow-production-binding.mjs --dry-run

# Apply catalog + binding + repo resource (idempotent)
node scripts/workflow-production-binding.mjs --apply
```

## Production workflow run

After binding is applied, start a Maintenance-project Hermes run from the repo root:

```bash
# Plan
node scripts/workflow-production-run.mjs --dry-run

# Create parent issue + workflow run ledger
node scripts/workflow-production-run.mjs --start

# Drive Hermes stages through final_package
node scripts/workflow-production-run.mjs --campaign

# Human final review (closes parent + stage issues)
node scripts/workflow-production-run.mjs --human-review

# Inspect saved state + final package index
node scripts/workflow-production-run.mjs --report
```

Artifacts land under `Artifacts/workflows/<workflow-run-id>/`. CLI state is persisted at `.multica-spine/production-run-state.json`.

Runbook: [`docs/workflow-production-run-runbook.md`](workflow-production-run-runbook.md)

### Daemon task context

Workflow scripts auto-remove a stale `.multica/daemon_task_context.json` before live Multica calls (v0.5.2+). If you invoke `multica` directly, delete the marker when not inside an agent task.

## Difference from sandbox canary

| | Sandbox canary | Production binding |
|---|---|---|
| Project | `pi-multica-spine Idea-to-Build Canary` | `pi-multica-spine Maintenance` |
| `prRequired` | `false` | `true` |
| `releaseAllowed` | `false` | `true` (human gate) |
| Script | `workflow-sandbox-canary.mjs` | `workflow-production-binding.mjs` + `workflow-production-run.mjs` |

Do **not** pass sandbox project IDs to the production binding script.
