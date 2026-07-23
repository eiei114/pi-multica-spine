# Workflow Campaign walkthrough

Offline walkthrough for the **Hermes Campaign** path: workflow catalog → project binding → run ledger → staged artifacts via `runCanaryCampaign`, using an in-memory fixture `WorkflowLiveCli`.

No `multica` CLI or network access is required.

## Run

```bash
node examples/workflow-campaign-walkthrough/run-walkthrough.mjs
```

Success prints JSON with `ok: true`, `campaign.stageCount >= 1`, and a stable `ledgerHash`. `deliveryPolicy.productionAllowed` stays `false`.

## What it exercises

| Step | Component |
| --- | --- |
| Catalog bootstrap | `WorkflowCatalogStore` quarantined → audited → active |
| Binding | `ProjectWorkflowBindingStore` sandbox delivery policy |
| Run ledger | `WorkflowRunStateStore.create` + seeded `capture` stage |
| Campaign driver | `runCanaryCampaign` with fixture live CLI |
| Human Gate | `productionAllowed=false` enforced in binding |

## Live lane next

After this offline demo, use the real sandbox canary:

```bash
node scripts/workflow-sandbox-canary.mjs --dry-run
```

See [`docs/workflow-ops-checklist.md`](../../docs/workflow-ops-checklist.md) and [`docs/workflow-sandbox-canary-runbook.md`](../../docs/workflow-sandbox-canary-runbook.md).
