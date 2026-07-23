# Workflow Campaign walkthrough

Offline walkthrough for the **Hermes Campaign** path: workflow catalog → project binding → run ledger → full `runCanaryCampaign` through `final_package`, then offline human review. Uses an in-memory fixture `WorkflowLiveCli`.

No `multica` CLI or network access is required.

## Run

```bash
node examples/workflow-campaign-walkthrough/run-walkthrough.mjs
```

Success prints JSON with `ok: true`, `campaign.currentStageId: "final_package"`, `humanReview.verdict: "approved"`, and a stable `ledgerHash`. `deliveryPolicy.productionAllowed` stays `false`.

The campaign advances through Hermes stages without manual ledger seeding (R-MNT-16). Human review runs only after the campaign completes at `final_package`.

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
