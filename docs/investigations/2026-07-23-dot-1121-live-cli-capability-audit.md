# Workflow Adapter Live CLI Capability Audit (DOT-1121)

Date: 2026-07-23

## Summary

PR #27 shipped repo-local workflow control-plane primitives. DOT-1121 wires them to the **live** `multica` CLI for stage issue lifecycle, parent summary writeback, artifact lineage metadata, run metadata reads, and autopilot trigger invocation.

## Capability matrix

| Contract need | Multica CLI today | Pi implementation | Gap |
|---|---|---|---|
| Workflow catalog lookup | No dedicated server catalog API (by design: audited repo-local manifests) | `WorkflowCatalogStore` (repo-local) | None — catalog stays repo-local per contract |
| Project binding validation | `multica project get <uuid> --output json` | `ProjectWorkflowBindingStore.save` via `WorkflowLiveCli.verifyProject` | None |
| Parent summary writeback | `multica issue metadata set` (per key) | `WorkflowLiveCli.writeParentSummary` | None |
| Run ledger append | No server ledger API (by design: repo-local JSON ledger) | `WorkflowRunStateStore` + optional parent metadata read via `readRunMetadata` | None for MVP |
| Stage issue create | `multica issue create --parent --project --assignee-id --status` | `WorkflowLiveCli.createStageIssue` | None |
| Stage issue assign | `multica issue assign --to-id` | `WorkflowLiveCli.assignStageIssue` | None |
| Stage issue status transition | `multica issue status <id> <status>` | `WorkflowLiveCli.transitionStageIssue` | None |
| Artifact lineage metadata | `multica issue metadata set` | `WorkflowLiveCli.writeStageWriteback` (`workflow_artifact_*` keys + `completion_authority`) | None |
| PR metadata writeback | `multica issue metadata set` (`pr_url`, `pr_number`, `pr_head_sha`, `pr_branch`) | `writeStageWriteback` | None |
| Autopilot execution path | `multica autopilot trigger <id>` | `WorkflowLiveCli.triggerAutopilot` + `multica_workflow_autopilot_trigger` tool | None |
| Controller lease/fencing/reconcile | Not in CLI surface (DOT-1116 child 2) | Out of scope | **Product gap filed only if attempted** — not stubbed in this PR |
| Hermes composite adapter execution | Not in CLI surface (DOT-1116 child 3) | Out of scope | Deferred to child 3 |

## Product gaps intentionally not stubbed

No new product-gap child issues were required for this slice: every in-scope operation maps to an existing `multica` CLI command. Missing controller lease/reconcile and Hermes execution remain explicitly owned by later DOT-1116 children and are not simulated here.

## Test strategy

- Unit tests use injectable `MulticaRunner` / `WorkflowLiveCli` fixtures (`tests/workflow-live-cli.test.mjs`, `tests/workflow-multica-cli.test.mjs`).
- Extension integration tests inject fixture live CLI to avoid accidental network/workspace mutation (`tests/workflow-extension-tools.test.mjs`).
- Live workspace evidence is captured separately during DOT-1121 verification (issue comment + PR body).
