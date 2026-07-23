# Production Workflow Run Runbook

This runbook covers `scripts/workflow-production-run.mjs` for the **pi-multica-spine Maintenance** Hermes lane (`prRequired=true`).

## Prerequisites

1. Production binding applied: `node scripts/workflow-production-binding.mjs --apply`
2. `multica` CLI authenticated for your user token (not a stale daemon task marker)
3. Repo path matches binding: `C:/Users/Keisu/Projects/OSS/pi-multica-spine`

## Modes

| Flag | Purpose |
|---|---|
| `--dry-run` | Print plan (project, rough idea, delivery policy) |
| `--start` | Create parent issue + workflow run ledger + controller autopilot |
| `--campaign` | Drive Hermes stages through `final_package` |
| `--human-review` | Approve completed run; close parent + stage issues |
| `--report` | Regenerate final package index from saved state |

## Typical flow

```bash
node scripts/workflow-production-run.mjs --dry-run
node scripts/workflow-production-run.mjs --start
node scripts/workflow-production-run.mjs --campaign
node scripts/workflow-production-run.mjs --human-review
node scripts/workflow-production-run.mjs --report
```

## Daemon task context guard

When **not** running inside a Multica agent task, a leftover `.multica/daemon_task_context.json` causes:

```txt
agent execution context requires MULTICA_TOKEN to be a task-scoped mat_ token
```

As of v0.5.2, `--start`, `--campaign`, and `--human-review` call `clearStaleDaemonTaskContext()` automatically. Manual cleanup:

```bash
rm -f .multica/daemon_task_context.json
```

## Artifacts

- Workflow artifacts: `Artifacts/workflows/<workflow-run-id>/` (gitignored)
- Final package index: `Artifacts/workflows/<run-id>/final/`
- CLI state: `.multica-spine/production-run-state.json` (gitignored)

## Policy

| Gate | Production binding |
|---|---|
| `prRequired` | `true` |
| `releaseAllowed` | `true` (human-owned) |
| `productionAllowed` | `false` |
| `destructiveAllowed` | `false` |

## Evidence

Live run records: `docs/investigations/2026-07-24-production-workflow-run-evidence.md` (DOT-1137).

See also [`docs/production-workflow-binding.md`](production-workflow-binding.md).
