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

test("resuming a blocked receipt clears its stale blocker", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "promotion-receipt-unblock-"));
  const store = new PromotionReceiptStore(cwd, "idea-unblock");
  await store.start({ sessionId: "idea-unblock", workflowRunId: "idea-unblock", artifactBundleHash: "a".repeat(64), projectTitle: "Daily Relic iOS" });
  await store.block("transient failure");
  const receipt = await store.completeStep("project_resolved");
  assert.equal(receipt.status, "in_progress");
  assert.equal(receipt.blockedReason, undefined);
});

test("explicit reconciliation clears a stale blocker only after completion", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "promotion-receipt-reconcile-"));
  const store = new PromotionReceiptStore(cwd, "idea-reconcile");
  await store.start({ sessionId: "idea-reconcile", workflowRunId: "idea-reconcile", artifactBundleHash: "a".repeat(64), projectTitle: "Daily Relic iOS" });
  await assert.rejects(store.reconcileCompleted(), /Only fully completed/);
  for (const step of ["project_resolved", "binding_saved", "parent_created", "run_created", "artifacts_imported", "parent_summary_written", "spec_review_seeded", "project_activated"]) await store.completeStep(step);
  await store.block("stale");
  const reconciled = await store.reconcileCompleted();
  assert.equal(reconciled.blockedReason, undefined);
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
