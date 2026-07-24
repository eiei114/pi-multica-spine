import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  PortfolioQueueStore,
  buildPortfolioAdmissionPlan,
  isPortfolioSlotAvailable,
  selectPortfolioCandidate,
} = await import("../lib/portfolio-queue.ts");

test("portfolio queue selects planned reuse before fifo", () => {
  const candidate = selectPortfolioCandidate({
    entries: [
      { sessionId: "b", workflowRunId: "b", projectTitle: "New App", promotionReadyAt: "2026-07-24T01:00:00.000Z", artifactBundleHash: "b".repeat(64), status: "queued" },
      { sessionId: "a", workflowRunId: "a", projectTitle: "Daily Relic iOS", promotionReadyAt: "2026-07-24T02:00:00.000Z", artifactBundleHash: "a".repeat(64), status: "queued" },
    ],
    plannedProjects: [{ id: "daily", title: "Daily Relic iOS", status: "planned" }],
  });
  assert.equal(candidate?.entry.sessionId, "a");
  assert.equal(candidate?.selectionReason, "planned_reuse");
  assert.equal(candidate?.plannedProjectId, "daily");
});

test("portfolio queue global-1 fencing blocks concurrent admission", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "portfolio-queue-"));
  const store = new PortfolioQueueStore(cwd);
  await store.enqueue({ sessionId: "one", workflowRunId: "one", projectTitle: "One", artifactBundleHash: "1".repeat(64) });
  await store.admit("one");
  await assert.rejects(store.admit("two"), /global-1 fencing/);
});

test("portfolio dry-run reports mutations without apply", () => {
  const candidate = selectPortfolioCandidate({
    entries: [{ sessionId: "one", workflowRunId: "one", projectTitle: "One", promotionReadyAt: "2026-07-24T00:00:00.000Z", artifactBundleHash: "1".repeat(64), status: "queued" }],
    plannedProjects: [],
  });
  const plan = buildPortfolioAdmissionPlan(candidate);
  assert.ok(plan.mutations.includes("seed_spec_review"));
  assert.equal(isPortfolioSlotAvailable({ activeSessionId: undefined }), true);
});
