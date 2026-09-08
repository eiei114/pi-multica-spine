# Workflow Campaign walkthrough

Offline walkthrough for the **Hermes Idea-to-Build** path (adapter v2): workflow catalog → project binding → run ledger → full `runCanaryCampaign` through `final_package`, then offline human review. Uses an in-memory fixture `WorkflowLiveCli`.

No `multica` CLI or network access is required.

## Run

From the repo root (runs both offline walkthroughs):

```bash
npm run walkthrough
```

Or run only this example:

```bash
node examples/workflow-campaign-walkthrough/run-walkthrough.mjs
```

Success prints JSON with `ok: true`, `campaign.currentStageId: "final_package"`, `humanReview.verdict: "approved"`, and a stable `ledgerHash`. `deliveryPolicy.productionAllowed` stays `false`.

The campaign advances through Hermes stages without manual ledger seeding. Human review runs only after the campaign completes at `final_package`.

### Default offline stages (12)

The walkthrough binding uses a non-visual target, so target-conditional and controller-conditional stages are skipped. The campaign runs these stages in order:

1. `capture`
2. `question_resolution`
3. `design_doc`
4. `implementation_spec`
5. `build_handoff`
6. `spec_review`
7. `implementation_plan`
8. `implementation`
9. `spec_compliance_review`
10. `code_quality_review`
11. `verification`
12. `final_package`

Skipped in this offline demo: `ui_design_brief`, `spec_fix`, `scaffold_resolution`, `asset_generation`, and `visual_review`. Pass an explicit visual target in live Idea-to-Build sessions to exercise those lanes.

## What it exercises

| Step | Component |
| --- | --- |
| Catalog bootstrap | `WorkflowCatalogStore` quarantined → audited → active |
| Binding | `ProjectWorkflowBindingStore` sandbox delivery policy |
| Run ledger | `WorkflowRunStateStore.create` with `capture` initial stage |
| Campaign driver | `runCanaryCampaign` through `final_package` with fixture live CLI |
| Human review | `completeHumanFinalReview` after natural campaign completion |
| Human Gate | `productionAllowed=false` enforced in binding |

## Live lane next

After this offline demo, run the automated sandbox checklist and live canary:

```bash
npm run check:sandbox-checklist        # offline (CI)
npm run check:sandbox-checklist -- --live   # requires multica CLI
node scripts/workflow-sandbox-canary.mjs --dry-run
```

See [`docs/workflow-ops-checklist.md`](../../docs/workflow-ops-checklist.md) and [`docs/workflow-sandbox-canary-runbook.md`](../../docs/workflow-sandbox-canary-runbook.md).
