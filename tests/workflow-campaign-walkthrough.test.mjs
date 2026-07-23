import assert from "node:assert/strict";
import test from "node:test";

import { runWorkflowCampaignWalkthrough } from "../examples/workflow-campaign-walkthrough/run-walkthrough.mjs";

test("workflow campaign walkthrough reaches final_package and human review offline", async () => {
  const summary = await runWorkflowCampaignWalkthrough({ includeHumanReview: true });
  assert.equal(summary.ok, true);
  assert.equal(summary.catalogStatus, "active");
  assert.equal(summary.deliveryPolicy.productionAllowed, false);
  assert.equal(summary.campaign.completed, true);
  assert.equal(summary.campaign.currentStageId, "final_package");
  assert.ok(summary.campaign.stageCount >= 10);
  assert.equal(summary.humanReview?.verdict, "approved");
  assert.match(summary.humanReview?.reviewArtifactPath ?? "", /10-human-final-review\.md$/);
  assert.match(summary.ledgerHash, /^[a-f0-9]{64}$/);
});
