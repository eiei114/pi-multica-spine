import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFreshCanaryPath,
  buildSandboxCanaryPlan,
  parseWorkflowSandboxCanaryArgs,
  resolveRoughIdea,
  slugifyRoughIdea,
} from "../scripts/workflow-sandbox-canary.mjs";
import {
  parseWorkflowIdeaEntryArgs,
  resolveIdeaEntryCanaryPath,
  runWorkflowIdeaEntry,
  validateRoughIdea,
} from "../scripts/workflow-idea-entry.mjs";

test("slugifyRoughIdea produces filesystem-safe slug", () => {
  assert.equal(slugifyRoughIdea("Build a Notes App!"), "build-a-notes-app");
});

test("buildFreshCanaryPath includes slug and suffix", () => {
  const path = buildFreshCanaryPath("Voice memo pipeline", {
    now: new Date("2026-07-24T12:00:00.000Z"),
    sessionSuffix: "20260724T120000",
  });
  assert.match(path, /voice-memo-pipeline-20260724T120000$/);
});

test("resolveIdeaEntryCanaryPath defaults to fresh session", () => {
  const path = resolveIdeaEntryCanaryPath("A sufficiently long product idea", {
    sessionSuffix: "test-session",
  });
  assert.match(path, /idea-sessions/);
  assert.match(path, /test-session$/);
});

test("resolveIdeaEntryCanaryPath honors reuse-default-canary", () => {
  const path = resolveIdeaEntryCanaryPath("A sufficiently long product idea", {
    reuseDefaultCanary: true,
  });
  assert.match(path, /idea-to-build-canary$/);
});

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

test("runWorkflowIdeaEntry offline plan uses fresh session by default", async () => {
  const report = await runWorkflowIdeaEntry({
    roughIdea: "Build a habit tracker CLI with JSON export and weekly digest",
    sessionSuffix: "ci-offline-session",
  });
  assert.equal(report.ok, true);
  assert.equal(report.mode, "offline-plan");
  assert.equal(report.freshSession, true);
  assert.match(report.canaryPath, /ci-offline-session$/);
  assert.equal(report.plan.roughIdea, report.roughIdea);
  assert.equal(report.skillCommand, "/skill:idea-to-build");
});

