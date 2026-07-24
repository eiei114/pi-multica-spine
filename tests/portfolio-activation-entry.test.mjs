import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { activatePortfolioIfReady } = await import("../lib/portfolio-activation-entry.ts");
const { PortfolioFleetConfigStore } = await import("../lib/portfolio-fleet-enablement.ts");

const lane = { sessionId: "idea", workflowRunId: "run", roughIdea: "idea", currentStageId: "build_handoff", status: "promotion_ready", createdAt: "now", updatedAt: "now" };
const artifacts = { schemaVersion: 1, sessionId: "idea", workflowRunId: "run", artifacts: [], artifactBundleHash: "a".repeat(64), updatedAt: "now" };
const input = { sessionId: "idea", workflowRunId: "run", projectTitle: "Idea", projectDescription: "idea", artifactBundleHash: "a".repeat(64), artifacts: [] };

test("activation remains local when fleet is disabled and fails closed without a factory", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "activation-entry-"));
  const store = new PortfolioFleetConfigStore(cwd);
  assert.deepEqual(await activatePortfolioIfReady({ cwd, lane, artifacts, fleetStore: store, buildPromotionInput: () => input, deps: {} }), { mode: "fleet_disabled" });
  await store.enable({ schemaVersion: 1, generatedAt: "now", checks: [], ok: true });
  await assert.rejects(activatePortfolioIfReady({ cwd, lane, artifacts, fleetStore: store, buildPromotionInput: () => input, deps: {} }), /no explicit promotion factory/);
});
