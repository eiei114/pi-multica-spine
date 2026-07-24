import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  MAX_CONTROLLER_RETRIES,
  STALL_THRESHOLD_MS,
  acquireForPrFeedback,
  applyControllerRetry,
  completeDeliveryLifecycle,
  evaluateStall,
  resumeFromArtifactRevision,
} = await import("../lib/portfolio-delivery-lifecycle.ts");
const { PortfolioFleetConfigStore, runFleetPreflight } = await import("../lib/portfolio-fleet-enablement.ts");

test("delivery lifecycle marks eight-hour stall and enforces two-retry ceiling", () => {
  const stalledAt = new Date("2026-07-24T12:00:00.000Z");
  const now = new Date(stalledAt.getTime() + STALL_THRESHOLD_MS + 1);
  const status = evaluateStall({
    status: "active",
    lastEvidenceAt: "2026-07-24T04:00:00.000Z",
  }, now);
  assert.equal(status, "stalled");
  let record = {
    schemaVersion: 1,
    sessionId: "idea",
    workflowRunId: "idea",
    projectId: "project",
    status: "stalled",
    retryCount: 0,
    prFeedbackCount: 0,
    updatedAt: stalledAt.toISOString(),
  };
  record = applyControllerRetry(record, "no_evidence");
  record = applyControllerRetry(record, "no_evidence");
  record = applyControllerRetry(record, "no_evidence");
  assert.equal(record.retryCount, MAX_CONTROLLER_RETRIES);
  assert.equal(record.status, "blocked");
  assert.equal(record.failurePackage?.reason, "no_evidence");
});

test("artifact revision returns blocked item to re-review and pr feedback is bounded", () => {
  const blocked = resumeFromArtifactRevision({
    schemaVersion: 1,
    sessionId: "idea",
    workflowRunId: "idea",
    projectId: "project",
    status: "blocked",
    retryCount: 2,
    prFeedbackCount: 0,
    failurePackage: { reason: "stalled", writtenAt: "2026-07-24T00:00:00.000Z" },
    updatedAt: "2026-07-24T00:00:00.000Z",
  }, "c".repeat(64));
  assert.equal(blocked.status, "awaiting_revision");
  let feedback = acquireForPrFeedback({
    schemaVersion: 1,
    sessionId: "idea",
    workflowRunId: "idea",
    projectId: "project",
    status: "active",
    retryCount: 0,
    prFeedbackCount: 0,
    updatedAt: "2026-07-24T00:00:00.000Z",
  });
  feedback = acquireForPrFeedback({ ...feedback, prFeedbackCount: 1, status: "pr_feedback" });
  feedback = acquireForPrFeedback({ ...feedback, prFeedbackCount: 2, status: "pr_feedback" });
  assert.equal(feedback.status, "blocked");
  const completed = completeDeliveryLifecycle({
    schemaVersion: 1,
    sessionId: "idea",
    workflowRunId: "idea",
    projectId: "project",
    status: "active",
    retryCount: 0,
    prFeedbackCount: 0,
    updatedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.equal(completed.status, "completed");
});

test("fleet switch remains off when preflight fails", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "fleet-enable-"));
  const store = new PortfolioFleetConfigStore(cwd);
  const report = runFleetPreflight({
    iosWalkthrough: true,
    webWalkthrough: false,
    windowsWalkthrough: true,
    dailyRelicPilot: true,
    runtimeRoutesReady: true,
  });
  assert.equal(report.ok, false);
  await assert.rejects(store.enable(report), /preflight failed/);
  assert.equal((await store.load()).enabled, false);
});

test("fleet switch enables only after all fixture preflight checks pass", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "fleet-enable-pass-"));
  const store = new PortfolioFleetConfigStore(cwd);
  const report = runFleetPreflight({
    iosWalkthrough: true,
    webWalkthrough: true,
    windowsWalkthrough: true,
    dailyRelicPilot: true,
    runtimeRoutesReady: true,
  });
  const config = await store.enable(report);
  assert.equal(config.enabled, true);
  assert.ok(config.enabledAt);
  const disabled = await store.disable();
  assert.equal(disabled.enabled, false);
});

test("delivery lifecycle store persists active records", async () => {
  const { PortfolioDeliveryLifecycleStore } = await import("../lib/portfolio-delivery-lifecycle.ts");
  const cwd = await mkdtemp(join(tmpdir(), "delivery-lifecycle-store-"));
  const store = new PortfolioDeliveryLifecycleStore(cwd, "idea-store");
  const record = await store.ensure({
    sessionId: "idea-store",
    workflowRunId: "idea-store",
    projectId: "project",
  });
  assert.equal(record.status, "active");
  const saved = await store.save({ ...record, status: "retrying" });
  assert.equal((await store.load())?.status, "retrying");
  assert.equal(saved.status, "retrying");
});
