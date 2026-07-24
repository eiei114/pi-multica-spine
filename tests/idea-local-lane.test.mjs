import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { IdeaLocalLaneStore, createIdeaLocalLane } = await import("../lib/idea-local-lane.ts");

test("local idea lane advances through build_handoff without Multica identifiers", () => {
  let lane = createIdeaLocalLane({
    sessionId: "idea-daily-relic",
    workflowRunId: "idea-daily-relic",
    roughIdea: "Build a Daily Relic iOS game",
  });

  assert.equal(lane.currentStageId, "capture");
  for (const stageId of ["question_resolution", "design_doc", "implementation_spec", "build_handoff"]) {
    lane = IdeaLocalLaneStore.advance(lane);
    assert.equal(lane.currentStageId, stageId);
  }
  lane = IdeaLocalLaneStore.advance(lane);

  assert.equal(lane.status, "promotion_ready");
  assert.equal(lane.currentStageId, "build_handoff");
  assert.equal("projectId" in lane, false);
  assert.equal("parentIssueId" in lane, false);
  assert.equal("autopilotId" in lane, false);
});

test("local idea lane persists one session state under the sandbox path", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-local-lane-"));
  const store = new IdeaLocalLaneStore(cwd);
  const created = await store.create({
    sessionId: "idea-daily-relic",
    workflowRunId: "idea-daily-relic",
    roughIdea: "Build a Daily Relic iOS game",
  });
  const advanced = await store.advance();

  assert.equal(created.currentStageId, "capture");
  assert.equal(advanced.currentStageId, "question_resolution");
  assert.deepEqual(await store.load(), advanced);
});

test("only a promotion-ready local lane can persist its implementation project", () => {
  let lane = createIdeaLocalLane({
    sessionId: "idea-daily-relic",
    workflowRunId: "idea-daily-relic",
    roughIdea: "Build a Daily Relic iOS game",
  });
  assert.throws(
    () => IdeaLocalLaneStore.bindImplementationProject(lane, { id: "daily-relic", title: "Daily Relic iOS" }),
    /build_handoff/,
  );

  for (let index = 0; index < 5; index += 1) lane = IdeaLocalLaneStore.advance(lane);
  lane = IdeaLocalLaneStore.bindImplementationProject(lane, { id: "daily-relic", title: "Daily Relic iOS" });

  assert.equal(lane.status, "promoted");
  assert.equal(lane.implementationProjectId, "daily-relic");
});
