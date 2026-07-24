---
name: idea-to-build
description: Start a local Hermes Idea-to-Build session after the human explicitly invokes this skill. Use ONLY when the user runs /skill:idea-to-build (never auto-detect). Keep Multica Project and Spine binding deferred until build_handoff.
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
4. Bootstrap the workflow only (see below). Do not advance a campaign during entry.
5. Advance the local lane to `promotion_ready` without per-stage human approval. Do not report a Multica parent or Project before promotion preflight succeeds.

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

`--execute` creates only a local sandbox session and the initial `capture` state. It creates **no** Multica Project, parent issue, Controller Autopilot, or Work Agent Spine binding.

## Stage-advance contract

- Entry advances the local lane through validated stages without waiting for a per-stage request.
- Use `node scripts/workflow-idea-stage-advance.mjs --canary-path <session-path> --to-promotion-ready`.
- Do not invoke the legacy `workflow-sandbox-canary.mjs` for a product idea. It is a separate Multica rehearsal harness.
- At `build_handoff`, reuse an exact-title planned Multica Project when one exists; otherwise create an implementation Project. Only then bind the implementation work to Spine.

## Bootstrap (plan only / no Multica mutations)

```bash
node scripts/workflow-idea-entry.mjs --rough-idea "<ROUGH_IDEA>" --dry-run --json
```

## What happens before Multica

After `--execute`:

1. A local sandbox path and session manifest are created.
2. The session advances through local artifact contracts to `promotion_ready`.
3. No Project, parent issue, Autopilot, resource, or Spine state is created.

At `build_handoff`, the implementation lane creates or reuses its Project, attaches implementation resources, and begins using Spine. Until then, the user does **not** need to run `multica` commands.

## Report back

Parse the JSON and tell the user:

| Field | Meaning |
|-------|---------|
| `workflowRunId` | Local idea session id |
| `campaign.currentStageId` | Current Hermes stage |
| `campaign.workflowStatus` | Run status |

Track status any time with:

```bash
node scripts/workflow-idea-status.mjs --json
```

Or invoke `/skill:idea-status`.

## Policy

- **Never** set `productionAllowed=true`.
- Do not rotate secrets, change billing, or run destructive production ops.
- This skill targets the local Idea-to-Build lane. The sandbox canary and Maintenance production-run remain separate rehearsal lanes.

## Troubleshooting

| Issue | Action |
|-------|--------|
| `dist/lib` missing | `npm run build` |
| prior session already exists | omit `--reuse-default-canary`; each idea gets a fresh session path by default |
| wrong session resumed | use `--canary-path` from dry-run JSON |
| implementation must begin | complete `build_handoff`; then create or reuse the implementation Project and bind Spine |

See [`docs/workflow-idea-entry-live-execute-runbook.md`](../../docs/workflow-idea-entry-live-execute-runbook.md).
