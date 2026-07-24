import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSandboxCanaryPlan,
  parseWorkflowSandboxCanaryArgs,
  resolveRoughIdea,
} from "../scripts/workflow-sandbox-canary.mjs";
import {
  parseWorkflowIdeaEntryArgs,
  runWorkflowIdeaEntry,
  validateRoughIdea,
} from "../scripts/workflow-idea-entry.mjs";

test("resolveRoughIdea uses custom --rough-idea", () => {
  const config = parseWorkflowSandboxCanaryArgs(["--dry-run", "--rough-idea", "Build a notes app with offline sync"]);
  assert.equal(resolveRoughIdea(config), "Build a notes app with offline sync");
});

test("buildSandboxCanaryPlan carries rough idea into plan", () => {
  const plan = buildSandboxCanaryPlan(
    parseWorkflowSandboxCanaryArgs(["--dry-run", "--rough-idea", "Voice memo to markdown pipeline"]),
  );
  assert.equal(plan.roughIdea, "Voice memo to markdown pipeline");
});

test("parseWorkflowIdeaEntryArgs defaults to offline json", () => {
  const args = parseWorkflowIdeaEntryArgs([]);
  assert.equal(args.execute, false);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
});

test("validateRoughIdea rejects empty and short ideas", () => {
  assert.equal(validateRoughIdea("").ok, false);
  assert.equal(validateRoughIdea("too short").ok, false);
  assert.equal(validateRoughIdea("A sufficiently long product idea").ok, true);
});

test("runWorkflowIdeaEntry offline plan passes in CI", async () => {
  const report = await runWorkflowIdeaEntry({
    roughIdea: "Build a habit tracker CLI with JSON export and weekly digest",
  });
  assert.equal(report.ok, true);
  assert.equal(report.mode, "offline-plan");
  assert.equal(report.plan.roughIdea, report.roughIdea);
  assert.equal(report.skillCommand, "/skill:idea-to-build");
});
