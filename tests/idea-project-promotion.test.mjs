import assert from "node:assert/strict";
import test from "node:test";

const {
  buildImplementationSpineHandoff,
  resolveImplementationProject,
} = await import("../lib/idea-project-promotion.ts");

test("promotion reuses one exact-title planned project", async () => {
  let created = false;
  const result = await resolveImplementationProject({
    projectTitle: "Daily Relic iOS",
    projectDescription: "implementation lane",
    client: {
      async list() {
        return [
          { id: "other", title: "Daily Relic iOS", status: "completed" },
          { id: "daily-relic", title: "Daily Relic iOS", status: "planned" },
        ];
      },
      async create() {
        created = true;
        return { id: "created", title: "Daily Relic iOS", status: "planned" };
      },
    },
  });

  assert.equal(result.project.id, "daily-relic");
  assert.equal(result.reused, true);
  assert.equal(created, false);
});

test("promotion creates a project when no exact planned project exists", async () => {
  const result = await resolveImplementationProject({
    projectTitle: "New iOS Game",
    projectDescription: "implementation lane",
    client: {
      async list() { return [{ id: "other", title: "New iOS Game", status: "completed" }]; },
      async create(input) { return { id: "created", title: input.title, status: "planned" }; },
    },
  });

  assert.equal(result.project.id, "created");
  assert.equal(result.reused, false);
});

test("promotion handoff requires project-bound Spine binding before implementation", () => {
  const handoff = buildImplementationSpineHandoff({
    project: { id: "daily-relic", title: "Daily Relic iOS", status: "planned" },
    workflowRunId: "idea-daily-relic",
  });

  assert.equal(handoff.projectId, "daily-relic");
  assert.equal(handoff.spineRequired, true);
  assert.match(handoff.nextAction, /multica_spine_bind/);
});
