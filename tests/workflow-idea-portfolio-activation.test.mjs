import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { IdeaLocalArtifactStore } = await import("../lib/idea-local-artifact.ts");
const { IdeaLocalLaneStore } = await import("../lib/idea-local-lane.ts");
const { PortfolioFleetConfigStore } = await import("../lib/portfolio-fleet-enablement.ts");
const { advanceIdeaLocalStage } = await import("../scripts/workflow-idea-stage-advance.mjs");

test("promotion-ready stage remains local when fleet config is disabled", async () => {
  const canaryPath = await mkdtemp(join(tmpdir(), "idea-activation-"));
  let promoteCalls = 0;
  const laneStore = new IdeaLocalLaneStore(canaryPath);
  const initialLane = await laneStore.create({ sessionId: "idea", workflowRunId: "run", roughIdea: "Idea" });
  const artifactStore = new IdeaLocalArtifactStore(canaryPath, initialLane.sessionId);
  await artifactStore.finalizePromotionReady({
    sessionId: initialLane.sessionId,
    workflowRunId: initialLane.workflowRunId,
    stageArtifacts: ["capture", "question_resolution", "design_doc", "implementation_spec", "build_handoff"].map((stageId) => ({ stageId, outputPath: `${stageId}.md`, content: stageId })),
  });
  const result = await advanceIdeaLocalStage(canaryPath, {
    toPromotionReady: true,
    activationFactory: async ({ lane }) => {
      return {
        fleetStore: new PortfolioFleetConfigStore(canaryPath),
        buildPromotionInput: () => ({ sessionId: lane.sessionId, workflowRunId: lane.workflowRunId, projectTitle: "Idea", projectDescription: "Idea", artifactBundleHash: "a".repeat(64), artifacts: [] }),
        deps: {},
        promote: async () => { promoteCalls += 1; return { mode: "promoted" }; },
      };
    },
  });
  assert.equal(result.lane.status, "promotion_ready");
  assert.deepEqual(result.activation, { mode: "fleet_disabled" });
  assert.equal(promoteCalls, 0);
});
