import assert from "node:assert/strict";
import test from "node:test";

import { runWorkflowCampaignWalkthrough } from "../examples/workflow-campaign-walkthrough/run-walkthrough.mjs";

test("workflow campaign walkthrough advances stages and human review offline", async () => {
  const summary = await runWorkflowCampaignWalkthrough({ maxStageCycles: 2, includeHumanReview: true });
  assert.equal(summary.ok, true);
  assert.equal(summary.catalogStatus, "active");
  assert.equal(summary.deliveryPolicy.productionAllowed, false);
  assert.ok(summary.campaign.stageCount >= 1);
  assert.equal(summary.humanReview?.verdict, "approved");
  assert.match(summary.humanReview?.reviewArtifactPath ?? "", /10-human-final-review\.md$/);
  assert.match(summary.ledgerHash, /^[a-f0-9]{64}$/);
});
