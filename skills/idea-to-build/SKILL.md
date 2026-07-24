---
name: idea-to-build
description: Start the Hermes Idea-to-Build Multica workflow after the human explicitly invokes this skill. Use ONLY when the user runs /skill:idea-to-build (never auto-detect). Collect the rough idea, then bootstrap sandbox apply+campaign in the background.
disable-model-invocation: true
compatibility: Requires multica CLI (user token), npm run build, and pi-multica-spine scripts on PATH or repo root.
---

# Idea to Build

Human-initiated entry into the **Hermes Idea-to-Build** workflow on the **sandbox canary** lane.

## When to use

- The user explicitly typed **`/skill:idea-to-build`** (or `/skill:idea-to-build <idea>`).
- Do **not** load this skill from casual conversation alone.

## Your job

1. Confirm the skill was invoked deliberately.
2. If the rough idea is not already in the message after the command, ask once: **「どんなアイデアを作りたいですか？」**
3. Do not debate the idea at length — capture it verbatim (light formatting OK).
4. Bootstrap the workflow (see below).
5. Reply with: parent issue id, `workflowRunId`, current stage, and what happens next.

## Bootstrap (live)

From the **pi-multica-spine package root** (repo clone or installed npm package):

```bash
npm run build
node scripts/workflow-idea-entry.mjs --rough-idea "<ROUGH_IDEA>" --execute --json
```

Use a here-doc for multi-line ideas:

```bash
node scripts/workflow-idea-entry.mjs --rough-idea-file /tmp/rough-idea.txt --execute --json
```

## Bootstrap (plan only / no Multica mutations)

```bash
node scripts/workflow-idea-entry.mjs --rough-idea "<ROUGH_IDEA>" --dry-run --json
```

## What happens in Multica

After `--execute`:

1. Sandbox project binding (Hermes catalog, `productionAllowed=false`)
2. Parent Workflow Issue created with the rough idea as description
3. Workflow run ledger + controller autopilot
4. `--campaign` drives stages: capture → question_resolution → design_doc → … → implementation

The user does **not** need to run `multica` commands manually.

## Report back

Parse the JSON and tell the user:

| Field | Meaning |
|-------|---------|
| `parentIdentifier` | Multica parent issue (e.g. DOT-xxxx) |
| `workflowRunId` | Workflow run id |
| `campaign.currentStageId` | Current Hermes stage |
| `campaign.workflowStatus` | Run status |

If campaign is not complete, note they can resume with:

```bash
node scripts/workflow-sandbox-canary.mjs --campaign --max-stage-cycles 80
```

When `final_package` is reached:

```bash
node scripts/workflow-sandbox-canary.mjs --human-review
```

## Policy

- **Never** set `productionAllowed=true`.
- Do not rotate secrets, change billing, or run destructive production ops.
- This skill targets the **sandbox canary** lane only (not Maintenance production-run).

## Troubleshooting

| Issue | Action |
|-------|--------|
| `dist/lib` missing | `npm run build` |
| daemon `mat_` token error | remove `.multica/daemon_task_context.json` in canary repo |
| multica auth | re-authenticate user token |
| prior parent already exists | use fresh `--canary-path` under Sandbox |

See [`docs/workflow-sandbox-live-execute-runbook.md`](../../docs/workflow-sandbox-live-execute-runbook.md).
