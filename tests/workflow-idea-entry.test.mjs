import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  bootstrapLocalIdeaSession,
  buildLiveIdeaEntryNextSteps,
  parseWorkflowIdeaEntryArgs,
  resolveIdeaEntryCanaryPath,
  runWorkflowIdeaEntry,
  summarizeBootstrapRun,
  validateRoughIdea,
} from "../scripts/workflow-idea-entry.mjs";
import {
  CI_OFFLINE_IDEA_ENTRY,
  repairStaleCiIdeaEntryScratch,
  runCiOfflineIdeaEntryCheck,
} from "../scripts/ci-offline-idea-entry-check.mjs";

test("local idea bootstrap reaches capture without a Multica project or parent issue", async () => {
  const session = await bootstrapLocalIdeaSession({
    canaryPath: "C:/sandbox/daily-relic",
    sessionId: "daily-relic-20260724",
    roughIdea: "Build a Daily Relic iOS game",
    bootstrapSandboxRepo: async () => "abc123",
  });

  assert.equal(session.workflowRunId, "idea-daily-relic-20260724");
  assert.equal(session.currentStageId, "capture");
  assert.equal(session.initialCommit, "abc123");
  assert.equal("projectId" in session, false);
  assert.equal("parentIssueId" in session, false);
  assert.equal("autopilotId" in session, false);
});

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

test("live idea entry next steps retain the local session and defer project creation", () => {
  const campaignStep = buildLiveIdeaEntryNextSteps({
    canaryPath: "C:/sandbox/session-a",
    roughIdea: "A product idea with a specific seed",
    campaign: { completed: false },
  });
  assert.match(campaignStep[0], /C:\/sandbox\/session-a/);
  assert.match(campaignStep[0], /Do not create a Multica Project before build_handoff/);

  const reviewStep = buildLiveIdeaEntryNextSteps({
    canaryPath: "C:/sandbox/session-a",
    roughIdea: "ignored after completion",
    campaign: { completed: true },
  });
  assert.deepEqual(reviewStep, ["Implementation Project creation occurs at build_handoff, before implementation work starts."]);
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
  assert.equal(report.nextSteps.some((step) => step.includes("--run-full-campaign")), false);
  assert.match(report.nextSteps.at(-1), /advance one local stage/i);
});

test("runWorkflowIdeaEntry execute creates only a local capture session", async () => {
  const sessionsRoot = await mkdtemp(join(tmpdir(), "idea-entry-execute-"));
  const canaryPath = join(sessionsRoot, "daily-relic");
  const report = await runWorkflowIdeaEntry({
    execute: true,
    roughIdea: "Build a Daily Relic iOS game with a three-minute daily run",
    invocationToken: `local-capture-${Date.now()}`,
    canaryPath,
    sessionsRoot,
  });

  assert.equal(report.ok, true);
  assert.equal(report.campaign.currentStageId, "capture");
  assert.match(report.workflowRunId, /^idea-/);
  assert.equal("projectId" in report, false);
  assert.equal("parentIdentifier" in report, false);
  assert.match(report.result, /No Multica Project or Spine binding/);
});

test("repairStaleCiIdeaEntryScratch removes mismatched CI scratch state", async () => {
  const root = await mkdtemp(join(tmpdir(), "idea-entry-repair-"));
  const sessionsRoot = join(root, "sessions");
  const canaryPath = join(
    sessionsRoot,
    "ci-offline-idea-entry-validation-seed-ci-offline-idea-entry-validation",
  );
  const manifestPath = join(canaryPath, ".multica-spine", "idea-session-manifest.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      sessionId: "idea-stale000",
      invocationToken: "stale-token",
      normalizedInputHash: "a".repeat(64),
      canaryPath,
      lifecycleStatus: "planned",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }),
    "utf8",
  );

  const repaired = await repairStaleCiIdeaEntryScratch({
    ...CI_OFFLINE_IDEA_ENTRY,
    sessionsRoot: "sessions",
    cwd: root,
  });
  assert.equal(repaired.repaired, true);
  assert.equal(existsSync(manifestPath), false);
});

test("runCiOfflineIdeaEntryCheck is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "idea-entry-ci-check-"));
  const config = { ...CI_OFFLINE_IDEA_ENTRY, sessionsRoot: "sessions", cwd: root };
  const first = await runCiOfflineIdeaEntryCheck(config);
  const second = await runCiOfflineIdeaEntryCheck(config);
  assert.equal(first.ok, true, first.error);
  assert.equal(second.ok, true, second.error);
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(first.canaryPath, second.canaryPath);
});

test("runWorkflowIdeaEntry offline plan is idempotent with a fixed invocation token", async () => {
  const sessionsRoot = await mkdtemp(join(tmpdir(), "idea-entry-idempotent-"));
  const options = {
    roughIdea: "CI offline idea entry validation seed",
    sessionSuffix: "ci-offline-idea-entry-validation",
    sessionsRoot,
    invocationToken: "ci-offline-idea-entry-validation",
  };
  const first = await runWorkflowIdeaEntry(options);
  const second = await runWorkflowIdeaEntry(options);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(first.canaryPath, second.canaryPath);
  assert.equal(first.invocationToken, second.invocationToken);
});

test("runWorkflowIdeaEntry rejects a full campaign before build_handoff", async () => {
  const sessionsRoot = await mkdtemp(join(tmpdir(), "idea-entry-full-campaign-"));
  const report = await runWorkflowIdeaEntry({
    execute: true,
    runFullCampaign: true,
    roughIdea: "Build a Daily Relic iOS game with a three-minute daily run",
    invocationToken: `full-campaign-${Date.now()}`,
    canaryPath: join(sessionsRoot, "daily-relic"),
    sessionsRoot,
  });

  assert.equal(report.ok, false);
  assert.match(report.error, /unavailable before build_handoff/);
});
