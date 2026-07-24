import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { IdeaLocalLaneStore } = await import("../lib/idea-local-lane.ts");
const { IdeaLocalArtifactStore, REQUIRED_LOCAL_ARTIFACT_STAGES } = await import("../lib/idea-local-artifact.ts");
const { parsePortfolioPromoteArgs, runPortfolioPromotion } = await import("../scripts/workflow-portfolio-promote.mjs");

async function readyLane() {
  const cwd = await mkdtemp(join(tmpdir(), "portfolio-promote-"));
  const laneStore = new IdeaLocalLaneStore(cwd);
  const lane = await laneStore.create({ sessionId: "idea-1", workflowRunId: "run-1", roughIdea: "pilot" });
  await laneStore.advanceToPromotionReady();
  await new IdeaLocalArtifactStore(cwd, lane.sessionId).finalizePromotionReady({
    sessionId: lane.sessionId,
    workflowRunId: lane.workflowRunId,
    stageArtifacts: REQUIRED_LOCAL_ARTIFACT_STAGES.map((stageId) => ({ stageId, outputPath: `${stageId}.md`, content: stageId })),
  });
  return cwd;
}

test("promotion command requires explicit factory config", () => {
  assert.throws(() => parsePortfolioPromoteArgs(["--canary-path", "x"]), /--factory-config is required/);
});

test("promotion command stays local while fleet is disabled", async () => {
  const cwd = await readyLane();
  let promotionCalls = 0;
  const result = await runPortfolioPromotion({ canaryPath: cwd, factoryConfigPath: "operator.json", apply: true }, {
    loadConfig: async () => ({ projectTitle: "Daily Relic iOS", projectDescription: "pilot" }),
    createFactory: () => ({}),
    fleetStore: { async load() { return { enabled: false }; } },
    promote: async () => { promotionCalls += 1; return {}; },
  });
  assert.deepEqual(result, { mode: "fleet_disabled" });
  assert.equal(promotionCalls, 0);
});

test("dry-run promotion passes immutable artifacts without applying", async () => {
  const cwd = await readyLane();
  let received;
  await runPortfolioPromotion({ canaryPath: cwd, factoryConfigPath: "operator.json", apply: false }, {
    loadConfig: async () => ({ projectTitle: "Daily Relic iOS", projectDescription: "pilot" }),
    createFactory: () => ({}),
    fleetStore: { async load() { return { enabled: true }; } },
    promote: async (input) => { received = input; return { mode: "dry-run" }; },
  });
  assert.equal(received.dryRun, true);
  assert.equal(received.artifacts.length, REQUIRED_LOCAL_ARTIFACT_STAGES.length);
});
