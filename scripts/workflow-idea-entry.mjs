#!/usr/bin/env node
/**
 * Idea-to-build slash entry bootstrap (R-MNT-37).
 * Human invokes /skill:idea-to-build with a rough idea; this script starts the sandbox Hermes workflow.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { runWorkflowSandboxChecklist } from "./workflow-sandbox-checklist.mjs";
import {
  applySandboxCanary,
  buildFreshCanaryPath,
  buildSandboxCanaryPlan,
  DEFAULT_CANARY_PATH,
  parseWorkflowSandboxCanaryArgs,
  resolveRoughIdea,
  runSandboxCampaign,
} from "./workflow-sandbox-canary.mjs";
import { FULL_LIVE_CAMPAIGN_STAGE_CYCLES } from "./workflow-sandbox-rehearsal.mjs";

export const MIN_ROUGH_IDEA_LENGTH = 12;

export function parseWorkflowIdeaEntryArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes("--execute");
  const dryRun = argv.includes("--dry-run") || (!execute && !argv.includes("--plan"));
  const json = argv.includes("--json") || !argv.includes("--plain");
  const reuseDefaultCanary = argv.includes("--reuse-default-canary");
  const canaryPathArg = argv.find((arg, index) => argv[index - 1] === "--canary-path");
  const roughIdeaArg = argv.find((arg, index) => argv[index - 1] === "--rough-idea");
  const roughIdeaFileArg = argv.find((arg, index) => argv[index - 1] === "--rough-idea-file");
  const maxStageCyclesArg = argv.find((arg, index) => argv[index - 1] === "--max-stage-cycles");
  const sessionSuffixArg = argv.find((arg, index) => argv[index - 1] === "--session-suffix");
  return {
    execute,
    dryRun,
    json,
    reuseDefaultCanary,
    canaryPath: canaryPathArg,
    roughIdea: roughIdeaArg,
    roughIdeaFile: roughIdeaFileArg,
    maxStageCycles: maxStageCyclesArg ? Number(maxStageCyclesArg) : FULL_LIVE_CAMPAIGN_STAGE_CYCLES,
    sessionSuffix: sessionSuffixArg,
  };
}

export function resolveIdeaEntryCanaryPath(roughIdea, options = {}) {
  if (options.canaryPath) return options.canaryPath;
  if (options.reuseDefaultCanary) return DEFAULT_CANARY_PATH;
  return buildFreshCanaryPath(roughIdea, { now: options.now, sessionSuffix: options.sessionSuffix });
}

export async function loadRoughIdeaFromArgs(args) {
  if (args.roughIdea?.trim()) return args.roughIdea.trim();
  if (args.roughIdeaFile) {
    return (await readFile(args.roughIdeaFile, "utf8")).trim();
  }
  return undefined;
}

export function validateRoughIdea(roughIdea) {
  if (!roughIdea?.trim()) {
    return { ok: false, error: "rough idea required (pass --rough-idea or --rough-idea-file)" };
  }
  if (roughIdea.trim().length < MIN_ROUGH_IDEA_LENGTH) {
    return { ok: false, error: `rough idea must be at least ${MIN_ROUGH_IDEA_LENGTH} characters` };
  }
  return { ok: true, roughIdea: roughIdea.trim() };
}

function canaryArgv(canaryPath, roughIdea, extra = []) {
  return ["--canary-path", canaryPath, "--rough-idea", roughIdea, ...extra];
}

export async function runWorkflowIdeaEntry(options = {}) {
  const loaded = options.roughIdea ?? (await loadRoughIdeaFromArgs(options));
  const validation = validateRoughIdea(loaded);
  if (!validation.ok) {
    return { ok: false, mode: "validation", error: validation.error };
  }
  const roughIdea = validation.roughIdea;
  const canaryPath = resolveIdeaEntryCanaryPath(roughIdea, {
    canaryPath: options.canaryPath,
    reuseDefaultCanary: options.reuseDefaultCanary ?? false,
    now: options.now,
    sessionSuffix: options.sessionSuffix,
  });
  const freshSession = !options.canaryPath && !(options.reuseDefaultCanary ?? false);
  const plan = buildSandboxCanaryPlan(
    parseWorkflowSandboxCanaryArgs(canaryArgv(canaryPath, roughIdea, ["--dry-run"])),
  );

  const checklist = await runWorkflowSandboxChecklist({
    live: options.execute ?? false,
    canaryPath,
  });
  if (!checklist.ok) {
    return { ok: false, mode: options.execute ? "live" : "offline", step: "preflight", checklist, plan };
  }

  if (!options.execute) {
    return {
      ok: true,
      mode: "offline-plan",
      roughIdea,
      canaryPath,
      freshSession,
      plan,
      checklist,
      skillCommand: "/skill:idea-to-build",
      nextSteps: [
        "Invoke /skill:idea-to-build then paste the rough idea",
        `node scripts/workflow-idea-entry.mjs --rough-idea ${JSON.stringify(roughIdea)} --execute`,
        "node scripts/workflow-sandbox-canary.mjs --campaign --max-stage-cycles 80",
      ],
    };
  }

  const applyConfig = parseWorkflowSandboxCanaryArgs(canaryArgv(canaryPath, roughIdea, ["--apply"]));
  const applyResult = await applySandboxCanary(applyConfig);
  const campaignConfig = parseWorkflowSandboxCanaryArgs(
    canaryArgv(canaryPath, roughIdea, [
      "--campaign",
      "--max-stage-cycles",
      String(options.maxStageCycles ?? FULL_LIVE_CAMPAIGN_STAGE_CYCLES),
    ]),
  );
  if (campaignConfig.maxStageCycles === undefined) {
    campaignConfig.maxStageCycles = options.maxStageCycles ?? FULL_LIVE_CAMPAIGN_STAGE_CYCLES;
  }
  const campaignResult = await runSandboxCampaign(campaignConfig);

  const ok =
    Boolean(applyResult.state?.workflowRunId) &&
    Boolean(campaignResult.campaign) &&
    plan.deliveryPolicy.productionAllowed === false;

  return {
    ok,
    mode: "live-start",
    roughIdea,
    canaryPath,
    freshSession,
    checklist,
    parentIdentifier: applyResult.state?.parentIdentifier,
    workflowRunId: applyResult.state?.workflowRunId,
    projectId: applyResult.state?.projectId,
    campaign: {
      completed: campaignResult.campaign.completed,
      workflowStatus: campaignResult.campaign.workflowStatus,
      currentStageId: campaignResult.campaign.currentStageId,
      stageCount: campaignResult.campaign.stages.length,
      stopReason: campaignResult.campaign.stopReason,
    },
    nextSteps: campaignResult.campaign.completed
      ? ["node scripts/workflow-sandbox-canary.mjs --human-review"]
      : ["node scripts/workflow-sandbox-canary.mjs --campaign --max-stage-cycles 80"],
  };
}

async function main() {
  const args = parseWorkflowIdeaEntryArgs();
  const report = await runWorkflowIdeaEntry({
    execute: args.execute,
    canaryPath: args.canaryPath,
    reuseDefaultCanary: args.reuseDefaultCanary,
    roughIdea: await loadRoughIdeaFromArgs(args),
    maxStageCycles: args.maxStageCycles,
    sessionSuffix: args.sessionSuffix,
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`mode: ${report.mode}`);
    console.log(`parent: ${report.parentIdentifier ?? "(planned)"}`);
    console.log(`workflowRunId: ${report.workflowRunId ?? "(planned)"}`);
    if (report.campaign) {
      console.log(`stage: ${report.campaign.currentStageId} (${report.campaign.workflowStatus})`);
    }
  } else {
    console.log(`idea entry failed: ${report.error ?? report.step ?? "unknown"}`);
  }
  if (!report.ok) process.exitCode = 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
