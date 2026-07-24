import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { IdeaLocalLaneStore } = await import("../lib/idea-local-lane.ts");
const { runIdeaBuildHandoff } = await import("../scripts/workflow-idea-build-handoff.mjs");

test("build handoff dry-run does not call Multica before apply", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-handoff-"));
  const store = new IdeaLocalLaneStore(cwd);
  await store.create({ sessionId: "idea-daily-relic", workflowRunId: "idea-daily-relic", roughIdea: "Daily Relic" });
  for (let index = 0; index < 5; index += 1) await store.advance();
  let calls = 0;

  const result = await runIdeaBuildHandoff({
    canaryPath: cwd,
    projectTitle: "Daily Relic iOS",
    runner: async () => { calls += 1; return { exitCode: 0, stdout: "[]", stderr: "" }; },
  });

  assert.equal(result.mode, "dry-run");
  assert.equal(calls, 0);
  assert.equal(result.spineHandoff.spineRequired, true);
});

test("build handoff apply reuses a matching planned project and persists it", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-handoff-apply-"));
  const store = new IdeaLocalLaneStore(cwd);
  await store.create({ sessionId: "idea-daily-relic", workflowRunId: "idea-daily-relic", roughIdea: "Daily Relic" });
  for (let index = 0; index < 5; index += 1) await store.advance();
  const result = await runIdeaBuildHandoff({
    canaryPath: cwd,
    projectTitle: "Daily Relic iOS",
    apply: true,
    runner: async (args) => ({ exitCode: 0, stdout: args[1] === "list" ? '[{"id":"daily-relic","title":"Daily Relic iOS","status":"planned"}]' : "{}", stderr: "" }),
  });

  assert.equal(result.mode, "applied");
  assert.equal(result.project.id, "daily-relic");
  assert.equal((await store.load()).status, "promoted");
});

test("build handoff apply creates an implementation project when no match exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-handoff-create-"));
  const store = new IdeaLocalLaneStore(cwd);
  await store.create({ sessionId: "idea-new", workflowRunId: "idea-new", roughIdea: "New game" });
  for (let index = 0; index < 5; index += 1) await store.advance();
  const calls = [];
  const result = await runIdeaBuildHandoff({
    canaryPath: cwd,
    projectTitle: "New iOS Game",
    apply: true,
    runner: async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: args[1] === "list" ? "[]" : '{"id":"new-game","title":"New iOS Game","status":"planned"}', stderr: "" };
    },
  });

  assert.equal(result.reused, false);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [["project", "list"], ["project", "create"]]);
});

test("build handoff fails closed when title has multiple planned matches", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "idea-handoff-duplicate-"));
  const store = new IdeaLocalLaneStore(cwd);
  await store.create({ sessionId: "idea-duplicate", workflowRunId: "idea-duplicate", roughIdea: "Duplicate" });
  for (let index = 0; index < 5; index += 1) await store.advance();

  await assert.rejects(
    runIdeaBuildHandoff({
      canaryPath: cwd,
      projectTitle: "Duplicate",
      apply: true,
      runner: async () => ({ exitCode: 0, stdout: '[{"id":"one","title":"Duplicate","status":"planned"},{"id":"two","title":"Duplicate","status":"planned"}]', stderr: "" }),
    }),
    /Multiple planned/,
  );
  assert.equal((await store.load()).status, "promotion_ready");
});
