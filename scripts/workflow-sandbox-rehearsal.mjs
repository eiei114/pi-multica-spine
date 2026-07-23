#!/usr/bin/env node
/**
 * Sandbox apply + campaign rehearsal automation (R-MNT-19).
 * Default offline mode validates orchestration for CI; --execute runs live multica ops.
 */
import { pathToFileURL } from "node:url";

import { runWorkflowSandboxChecklist } from "./workflow-sandbox-checklist.mjs";
import {
  applySandboxCanary,
  buildSandboxCanaryPlan,
  parseWorkflowSandboxCanaryArgs,
  runSandboxCampaign,
} from "./workflow-sandbox-canary.mjs";

export const SANDBOX_REHEARSAL_STEPS = ["preflight", "apply", "campaign"];

export const DEFAULT_LIVE_MAX_STAGE_CYCLES = 8;

export function parseWorkflowSandboxRehearsalArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes("--execute");
  const json = argv.includes("--json") || !argv.includes("--plain");
  const maxStageCyclesArg = argv.find((arg, index) => argv[index - 1] === "--max-stage-cycles");
  const canaryPathArg = argv.find((arg, index) => argv[index - 1] === "--canary-path");
  return {
    execute,
    json,
    maxStageCycles: maxStageCyclesArg ? Number(maxStageCyclesArg) : DEFAULT_LIVE_MAX_STAGE_CYCLES,
    canaryPath: canaryPathArg,
  };
}

function baseCanaryArgv(canaryPath, extra = []) {
  const argv = ["--canary-path", canaryPath, ...extra];
  return argv;
}

export function buildOfflineRehearsalPlan(canaryPath) {
  const dryPlan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--dry-run"])));
  const applyPlan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--apply"])));
  const campaignPlan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--campaign"])));
  const policyClosed =
    dryPlan.deliveryPolicy.productionAllowed === false &&
    applyPlan.deliveryPolicy.productionAllowed === false &&
    campaignPlan.deliveryPolicy.productionAllowed === false;
  return {
    ok: dryPlan.mode === "dry-run" && applyPlan.mode === "apply" && campaignPlan.mode === "campaign" && policyClosed,
    dryPlan,
    applyPlan,
    campaignPlan,
    steps: SANDBOX_REHEARSAL_STEPS,
  };
}

/**
 * @param {{ execute?: boolean, canaryPath?: string, maxStageCycles?: number }} [options]
 */
export async function runWorkflowSandboxRehearsal(options = {}) {
  const execute = options.execute ?? false;
  const canaryPath =
    options.canaryPath ?? buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs([])).canaryPath;
  const maxStageCycles = options.maxStageCycles ?? DEFAULT_LIVE_MAX_STAGE_CYCLES;

  const checklist = await runWorkflowSandboxChecklist({ live: execute, canaryPath });
  if (!checklist.ok) {
    return { ok: false, mode: execute ? "live" : "offline", step: "preflight", checklist };
  }

  if (!execute) {
    const plan = buildOfflineRehearsalPlan(canaryPath);
    return {
      ok: plan.ok,
      mode: "offline-rehearsal",
      canaryPath,
      steps: SANDBOX_REHEARSAL_STEPS,
      checklist,
      plan,
      nextSteps: [
        "npm run check:sandbox-rehearsal",
        "npm run check:sandbox-checklist -- --live",
        "node scripts/workflow-sandbox-rehearsal.mjs --execute",
      ],
    };
  }

  const applyConfig = parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--apply"]));
  const applyResult = await applySandboxCanary(applyConfig);
  const campaignConfig = parseWorkflowSandboxCanaryArgs(
    baseCanaryArgv(canaryPath, ["--campaign", "--max-stage-cycles", String(maxStageCycles)]),
  );
  campaignConfig.maxStageCycles = maxStageCycles;
  const campaignResult = await runSandboxCampaign(campaignConfig);

  const ok =
    Boolean(applyResult.state?.workflowRunId) &&
    Boolean(campaignResult.campaign) &&
    campaignResult.plan.deliveryPolicy.productionAllowed === false;

  return {
    ok,
    mode: "live-execute",
    canaryPath,
    steps: SANDBOX_REHEARSAL_STEPS,
    checklist,
    apply: {
      workflowRunId: applyResult.state?.workflowRunId,
      stopReason: applyResult.run?.stopReason,
      currentStageId: applyResult.run?.ledger?.currentStageId,
    },
    campaign: {
      completed: campaignResult.campaign.completed,
      workflowStatus: campaignResult.campaign.workflowStatus,
      currentStageId: campaignResult.campaign.currentStageId,
      stageCount: campaignResult.campaign.stages.length,
      stopReason: campaignResult.campaign.stopReason,
      maxStageCycles,
    },
  };
}

async function main() {
  const { execute, json, maxStageCycles, canaryPath } = parseWorkflowSandboxRehearsalArgs();
  const report = await runWorkflowSandboxRehearsal({ execute, maxStageCycles, canaryPath });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`mode: ${report.mode}`);
    for (const step of SANDBOX_REHEARSAL_STEPS) {
      console.log(`- ${step}`);
    }
    console.log(report.ok ? "sandbox rehearsal ok" : "sandbox rehearsal failed");
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
