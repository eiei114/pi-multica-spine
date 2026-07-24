import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  ScaffoldReceiptStore,
  assertScaffoldPreflight,
  resolveScaffoldedResources,
} = await import("../lib/scaffold-resolution.ts");

test("scaffold resolution blocks without target_surface and template_id", () => {
  assert.throws(() => assertScaffoldPreflight({}), /target_surface/);
  assert.throws(() => assertScaffoldPreflight({ targetSurface: "ios" }), /template_id/);
});

test("scaffold receipt resumes missing clone step without duplicate repository", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "scaffold-resolution-"));
  const store = new ScaffoldReceiptStore(cwd, "idea-1");
  let createCount = 0;
  let cloneCalls = 0;
  const collaborators = {
    async createRepository() {
      createCount += 1;
      return { url: "https://github.com/eiei114/daily-relic" };
    },
    async cloneRepository() {
      cloneCalls += 1;
      if (cloneCalls === 1) throw new Error("clone failed");
      return { clonePath: "/tmp/repo" };
    },
    async attachProjectResource() {
      return { resourceId: "resource-1" };
    },
  };
  const baseInput = {
    sessionId: "idea-1",
    workflowRunId: "idea-1",
    projectId: "project",
    targetSurface: "ios",
    templateId: "ios-swiftui-agent-app",
    projectTitle: "Daily Relic iOS",
  };
  let receipt = await resolveScaffoldedResources(baseInput, collaborators, store);
  receipt = await resolveScaffoldedResources(baseInput, collaborators, store);
  receipt = await resolveScaffoldedResources(baseInput, collaborators, store);
  assert.equal(receipt.status, "in_progress");
  assert.equal(createCount, 1);
  receipt = await resolveScaffoldedResources(baseInput, collaborators, store);
  receipt = await resolveScaffoldedResources(baseInput, collaborators, store);
  assert.equal(createCount, 1);
  assert.equal(receipt.completedSteps.includes("runtime_cloned"), true);
  assert.equal(receipt.completedSteps.includes("resource_attached"), true);
});
