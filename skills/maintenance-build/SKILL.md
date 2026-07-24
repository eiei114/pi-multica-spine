---
name: maintenance-build
description: Start the Hermes Maintenance Multica workflow after the human explicitly invokes this skill. Use ONLY when the user runs /skill:maintenance-build (never auto-detect). Collect the maintenance brief, then bootstrap production-run start+campaign in the background.
disable-model-invocation: true
compatibility: Requires multica CLI (user token), npm run build, pi-multica-spine repo checkout, and production binding applied.
---

# Maintenance Build

Human-initiated entry into the **Hermes Maintenance** workflow on the **production-run** lane (`productionAllowed=false`).

## When to use

- The user explicitly typed **`/skill:maintenance-build`** (or `/skill:maintenance-build <brief>`).
- Do **not** load this skill from casual conversation alone.

## Your job

1. Confirm the skill was invoked deliberately.
2. If the maintenance brief is not already in the message, ask once: **「どんなメンテナンス作業を進めますか？」**
3. Capture the brief verbatim (light formatting OK).
4. Bootstrap the workflow (see below).
5. Reply with: parent issue id, `workflowRunId`, current stage, and what happens next.

## Bootstrap (live)

From the **pi-multica-spine repo root**:

```bash
npm run build
node scripts/workflow-maintenance-entry.mjs --maintenance-brief "<BRIEF>" --execute --json
```

Multi-line brief:

```bash
node scripts/workflow-maintenance-entry.mjs --maintenance-brief-file /tmp/maintenance-brief.txt --execute --json
```

## Bootstrap (plan only / no Multica mutations)

```bash
node scripts/workflow-maintenance-entry.mjs --maintenance-brief "<BRIEF>" --dry-run --json
```

## What happens in Multica

After `--execute`:

1. Maintenance project binding (Hermes catalog, `productionAllowed=false`)
2. Parent Workflow Issue created with the brief as description (reuses existing parent if state already exists)
3. Workflow run ledger + controller autopilot
4. `--campaign` drives Hermes stages on the maintenance repo

## Report back

| Field | Meaning |
|-------|---------|
| `parentIdentifier` | Multica parent issue (e.g. DOT-xxxx) |
| `workflowRunId` | Workflow run id |
| `parentReused` | `true` when an existing maintenance parent was resumed |
| `campaign.currentStageId` | Current Hermes stage |
| `campaign.workflowStatus` | Run status |

Resume campaign:

```bash
node scripts/workflow-production-run.mjs --campaign --max-stage-cycles 80
```

When `final_package` is reached:

```bash
node scripts/workflow-production-run.mjs --human-review
```

## Policy

- **Never** set `productionAllowed=true`.
- Do not rotate secrets, change billing, or run destructive production ops.
- This skill targets the **Maintenance production-run** lane only (not sandbox Idea-to-Build).

## Troubleshooting

| Issue | Action |
|-------|--------|
| `dist/lib` missing | `npm run build` |
| Binding missing | `node scripts/workflow-production-binding.mjs --apply` |
| daemon `mat_` token error | remove `.multica/daemon_task_context.json` in repo root |
| multica auth | re-authenticate user token |

See [`docs/workflow-production-live-execute-runbook.md`](../../docs/workflow-production-live-execute-runbook.md).
