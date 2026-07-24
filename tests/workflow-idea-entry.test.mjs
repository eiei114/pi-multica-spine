import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFreshCanaryPath,
  buildSandboxCanaryPlan,
  parseWorkflowSandboxCanaryArgs,
  resolveCampaignStageCycles,
  resolveRoughIdea,
  slugifyRoughIdea,
} from "../scripts/workflow-sandbox-canary.mjs";
import {
  buildLiveIdeaEntryNextSteps,
  parseWorkflowIdeaEntryArgs,
  resolveIdeaEntryCanaryPath,
  runWorkflowIdeaEntry,
  summarizeBootstrapRun,
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
  assert.equal(args.runFullCampaign, false);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
});

test("parseWorkflowIdeaEntryArgs requires explicit full campaign opt-in", () => {
  const bootstrap = parseWorkflowIdeaEntryArgs(["--execute"]);
  const fullCampaign = parseWorkflowIdeaEntryArgs(["--execute", "--run-full-campaign"]);
  assert.equal(bootstrap.runFullCampaign, false);
  assert.equal(fullCampaign.runFullCampaign, true);
});

test("summarizeBootstrapRun preserves the initial stage without advancing the campaign", () => {
  const campaign = summarizeBootstrapRun({
    stopReason: "no_pending_controller_work",
    ledger: {
      workflowStatus: "waiting",
      currentStageId: "capture",
      stages: { capture: { status: "seeded" } },
    },
  });
  assert.deepEqual(campaign, {
    completed: false,
    workflowStatus: "waiting",
    currentStageId: "capture",
    stageCount: 1,
    stopReason: "no_pending_controller_work",
  });
});

test("sandbox campaign defaults to one stage and rejects unapproved multi-stage runs", () => {
  assert.equal(resolveCampaignStageCycles(parseWorkflowSandboxCanaryArgs(["--campaign"])), 1);
  assert.throws(
    () => resolveCampaignStageCycles(parseWorkflowSandboxCanaryArgs(["--campaign", "--max-stage-cycles", "80"])),
    /require --run-full-campaign/,
  );
  assert.equal(
    resolveCampaignStageCycles(parseWorkflowSandboxCanaryArgs(["--campaign", "--run-full-campaign", "--max-stage-cycles", "80"])),
    80,
  );
});

test("live idea entry next steps retain the canary session and rough idea", () => {
  const campaignStep = buildLiveIdeaEntryNextSteps({
    canaryPath: "C:/sandbox/session-a",
    roughIdea: "A product idea with a specific seed",
    campaign: { completed: false },
  });
  assert.match(campaignStep[0], /--canary-path "C:\/sandbox\/session-a"/);
  assert.match(campaignStep[0], /--rough-idea "A product idea with a specific seed"/);

  const reviewStep = buildLiveIdeaEntryNextSteps({
    canaryPath: "C:/sandbox/session-a",
    roughIdea: "ignored after completion",
    campaign: { completed: true },
  });
  assert.deepEqual(reviewStep, [
    'node scripts/workflow-sandbox-canary.mjs --canary-path "C:/sandbox/session-a" --human-review',
  ]);
});

test("validateRoughIdea rejects empty and short ideas", () => {
  assert.equal(validateRoughIdea("").ok, false);
  assert.equal(validateRoughIdea("too short").ok, false);
  assert.equal(validateRoughIdea("A sufficiently long product idea").ok, true);
});

test("runWorkflowIdeaEntry offline plan uses fresh session by default", async () => {
  const sessionsRoot = await mkdtemp(join(tmpdir(), "idea-entry-"));
  const report = await runWorkflowIdeaEntry({
    roughIdea: "Build a habit tracker CLI with JSON export and weekly digest",
    sessionSuffix: `ci-offline-${Date.now()}`,
    sessionsRoot,
  });
  assert.equal(report.ok, true);
  assert.equal(report.mode, "offline-plan");
  assert.equal(report.freshSession, true);
  assert.match(report.canaryPath, /ci-offline-/);
  assert.equal(report.plan.roughIdea, report.roughIdea);
  assert.equal(report.skillCommand, "/skill:idea-to-build");
});
