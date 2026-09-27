import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runWorkflowCampaignWalkthrough } from "../examples/workflow-campaign-walkthrough/run-walkthrough.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("workflow campaign walkthrough reaches final_package and human review offline", async () => {
  const summary = await runWorkflowCampaignWalkthrough({ includeHumanReview: true });
  assert.equal(summary.ok, true);
  assert.equal(summary.catalogStatus, "active");
  assert.equal(summary.deliveryPolicy.productionAllowed, false);
  assert.equal(summary.campaign.completed, true);
  assert.equal(summary.campaign.currentStageId, "final_package");
  assert.equal(summary.campaign.stageCount, 12);
  assert.deepEqual(summary.campaign.stages, [
    "capture",
    "question_resolution",
    "design_doc",
    "implementation_spec",
    "build_handoff",
    "spec_review",
    "implementation_plan",
    "implementation",
    "spec_compliance_review",
    "code_quality_review",
    "verification",
    "final_package",
  ]);
  assert.equal(summary.humanReview?.verdict, "approved");
  assert.match(summary.humanReview?.reviewArtifactPath ?? "", /10-human-final-review\.md$/);
  assert.match(summary.ledgerHash, /^[a-f0-9]{64}$/);
});

test("workflow campaign README describes the per-run ledger hash", () => {
  const readme = readFileSync(
    join(repoRoot, "examples/workflow-campaign-walkthrough/README.md"),
    "utf8",
  );
  assert.match(readme, /64-character `ledgerHash`/);
  assert.match(readme, /can differ between runs/);
  assert.doesNotMatch(readme, /stable `ledgerHash`/);
});
