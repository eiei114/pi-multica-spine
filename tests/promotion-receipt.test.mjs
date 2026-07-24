import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  PromotionReceiptStore,
  detectRouteGap,
  nextPromotionReceiptStep,
} = await import("../lib/promotion-receipt.ts");

test("promotion receipt resumes only missing steps", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "promotion-receipt-"));
  const store = new PromotionReceiptStore(cwd, "idea-1");
  let receipt = await store.start({
    sessionId: "idea-1",
    workflowRunId: "idea-1",
    artifactBundleHash: "a".repeat(64),
    projectTitle: "Daily Relic iOS",
  });
  receipt = await store.completeStep("project_resolved", { projectId: "project" });
  receipt = await store.completeStep("binding_saved", { bindingHash: "b".repeat(64) });
  assert.equal(nextPromotionReceiptStep(receipt), "parent_created");
  assert.deepEqual(receipt.completedSteps, ["project_resolved", "binding_saved"]);
});

test("route gap blocks candidate without creating agents", () => {
  const gap = detectRouteGap({
    requiredRoles: ["spec_reviewer", "scaffold_worker"],
    roleRoutes: { spec_reviewer: { agentId: "luna" } },
  });
  assert.equal(gap, "missing_route:scaffold_worker");
});

test("altered artifact bundle is rejected before mutation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "promotion-receipt-block-"));
  const store = new PromotionReceiptStore(cwd, "idea-2");
  const receipt = await store.start({
    sessionId: "idea-2",
    workflowRunId: "idea-2",
    artifactBundleHash: "a".repeat(64),
    projectTitle: "Daily Relic iOS",
  });
  await assert.rejects(
    async () => {
      const { assertPromotionReceiptCanResume } = await import("../lib/promotion-receipt.ts");
      assertPromotionReceiptCanResume(receipt, { artifactBundleHash: "b".repeat(64), projectTitle: "Daily Relic iOS" });
    },
    /artifact bundle hash mismatch/,
  );
});
