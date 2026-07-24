import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { IdeaLocalLaneStore } = await import("../lib/idea-local-lane.ts");
const { advanceIdeaLocalStage } = await import("../scripts/workflow-idea-stage-advance.mjs");

test("stage advance changes only the local lane by one stage", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-stage-advance-"));
  const store = new IdeaLocalLaneStore(cwd);
  await store.create({ sessionId: "idea-local", workflowRunId: "idea-local", roughIdea: "A sufficiently long local idea" });

  const state = await advanceIdeaLocalStage(cwd);

  assert.equal(state.currentStageId, "question_resolution");
  assert.equal("implementationProjectId" in state, false);
  assert.equal((await store.load()).currentStageId, "question_resolution");
});
