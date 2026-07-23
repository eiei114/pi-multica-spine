import assert from "node:assert/strict";
import test from "node:test";

import { runWorkflowCampaignWalkthrough } from "../examples/workflow-campaign-walkthrough/run-walkthrough.mjs";

test("workflow campaign walkthrough advances stages offline", async () => {
  const summary = await runWorkflowCampaignWalkthrough({ maxStageCycles: 2 });
  assert.equal(summary.ok, true);
  assert.equal(summary.catalogStatus, "active");
  assert.equal(summary.deliveryPolicy.productionAllowed, false);
  assert.ok(summary.campaign.stageCount >= 1);
  assert.match(summary.ledgerHash, /^[a-f0-9]{64}$/);
});
