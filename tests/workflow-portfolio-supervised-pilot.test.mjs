import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { IdeaLocalLaneStore } = await import("../lib/idea-local-lane.ts");
const { IdeaLocalArtifactStore, REQUIRED_LOCAL_ARTIFACT_STAGES } = await import("../lib/idea-local-artifact.ts");
const { parseSupervisedPilotArgs, runPortfolioSupervisedPilot } = await import("../scripts/workflow-portfolio-supervised-pilot.mjs");

async function readyLane() {
  const cwd = await mkdtemp(join(tmpdir(), "portfolio-pilot-"));
  const store = new IdeaLocalLaneStore(cwd);
  const lane = await store.create({ sessionId: "pilot-session", workflowRunId: "pilot-run", roughIdea: "Daily Relic" });
  await store.advanceToPromotionReady();
  await new IdeaLocalArtifactStore(cwd, lane.sessionId).finalizePromotionReady({
    sessionId: lane.sessionId, workflowRunId: lane.workflowRunId,
    stageArtifacts: REQUIRED_LOCAL_ARTIFACT_STAGES.map((stageId) => ({ stageId, outputPath: `${stageId}.md`, content: stageId })),
  });
  return cwd;
}

function config() {
  return { projectTitle: "Daily Relic iOS", projectDescription: "pilot", supervisedPilot: { projectId: "daily", projectTitle: "Daily Relic iOS" } };
}

test("supervised pilot requires --apply and exact configured planned project", async () => {
  const cwd = await readyLane();
  const options = { canaryPath: cwd, factoryConfigPath: "operator.json", evidenceOutput: join(cwd, "pilot.json"), apply: false };
  await assert.rejects(runPortfolioSupervisedPilot(options), /explicit --apply/);
  await assert.rejects(runPortfolioSupervisedPilot({ ...options, apply: true }, {
    loadConfig: async () => config(), createFactory: () => ({ projects: { async list() { return []; } } }),
  }), /exactly one configured planned Project/);
  assert.throws(() => parseSupervisedPilotArgs(["--canary-path", "x"]), /--factory-config is required/);
});

test("supervised pilot records hash-addressed evidence only after promoted result", async () => {
  const cwd = await readyLane();
  let written;
  let promotionInput;
  const result = await runPortfolioSupervisedPilot({ canaryPath: cwd, factoryConfigPath: "operator.json", evidenceOutput: join(cwd, "pilot.json"), apply: true }, {
    loadConfig: async () => config(),
    createFactory: () => ({ projects: { async list() { return [{ id: "daily", title: "Daily Relic iOS", status: "planned" }]; } } }),
    promote: async (input) => { promotionInput = input; return { mode: "promoted" }; },
    writeEvidence: async (_path, content) => { written = content; },
  });
  assert.equal(result.mode, "supervised_pilot");
  assert.match(written, /portfolio_supervised_pilot/);
  assert.match(result.evidence.hash, /^[a-f0-9]{64}$/);
  assert.match(result.evidence.path, new RegExp(`${result.evidence.hash}\\.json$`));
  assert.equal(promotionInput.expectedProjectId, "daily");
  const lane = await new IdeaLocalLaneStore(cwd).load();
  assert.equal(lane.status, "promoted");
  assert.equal(lane.implementationProjectId, "daily");
});
