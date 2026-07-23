#!/usr/bin/env node
/**
 * Sandbox apply + campaign rehearsal automation (R-MNT-19).
 * Default offline mode validates orchestration for CI; --execute runs live multica ops.
 */
import { pathToFileURL } from "node:url";

import { runWorkflowSandboxChecklist } from "./workflow-sandbox-checklist.mjs";
import { runSandboxCloseoutEvidence } from "./workflow-sandbox-closeout-evidence.mjs";
import {
  applySandboxCanary,
  buildSandboxCanaryPlan,
  parseWorkflowSandboxCanaryArgs,
  runHumanFinalReview,
  runSandboxCampaign,
} from "./workflow-sandbox-canary.mjs";

export const SANDBOX_REHEARSAL_STEPS = ["preflight", "apply", "campaign"];
export const SANDBOX_FULL_CLOSEOUT_STEPS = ["preflight", "apply", "campaign", "human-review"];

export const DEFAULT_LIVE_MAX_STAGE_CYCLES = 8;
export const FULL_LIVE_CAMPAIGN_STAGE_CYCLES = 80;
export const HERMES_FINAL_STAGE_ID = "final_package";

export function parseWorkflowSandboxRehearsalArgs(argv = process.argv.slice(2)) {
  const execute = argv.includes("--execute");
  const fullCloseout = argv.includes("--full-closeout");
  const json = argv.includes("--json") || !argv.includes("--plain");
  const maxStageCyclesArg = argv.find((arg, index) => argv[index - 1] === "--max-stage-cycles");
  const canaryPathArg = argv.find((arg, index) => argv[index - 1] === "--canary-path");
  const defaultCycles = fullCloseout ? FULL_LIVE_CAMPAIGN_STAGE_CYCLES : DEFAULT_LIVE_MAX_STAGE_CYCLES;
  return {
    execute,
    fullCloseout,
    json,
    maxStageCycles: maxStageCyclesArg ? Number(maxStageCyclesArg) : defaultCycles,
    canaryPath: canaryPathArg,
  };
}

function baseCanaryArgv(canaryPath, extra = []) {
  const argv = ["--canary-path", canaryPath, ...extra];
  return argv;
}

export function buildOfflineRehearsalPlan(canaryPath, options = {}) {
  const fullCloseout = options.fullCloseout ?? false;
  const dryPlan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--dry-run"])));
  const applyPlan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--apply"])));
  const campaignPlan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--campaign"])));
  const humanReviewPlan = fullCloseout
    ? buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--human-review"])))
    : undefined;
  const policyClosed =
    dryPlan.deliveryPolicy.productionAllowed === false &&
    applyPlan.deliveryPolicy.productionAllowed === false &&
    campaignPlan.deliveryPolicy.productionAllowed === false &&
    (!humanReviewPlan || humanReviewPlan.deliveryPolicy.productionAllowed === false);
  const modesOk =
    dryPlan.mode === "dry-run" &&
    applyPlan.mode === "apply" &&
    campaignPlan.mode === "campaign" &&
    (!fullCloseout || humanReviewPlan?.mode === "human-review");
  return {
    ok: modesOk && policyClosed,
    fullCloseout,
    dryPlan,
    applyPlan,
    campaignPlan,
    humanReviewPlan,
    maxStageCycles: fullCloseout ? FULL_LIVE_CAMPAIGN_STAGE_CYCLES : DEFAULT_LIVE_MAX_STAGE_CYCLES,
    steps: fullCloseout ? SANDBOX_FULL_CLOSEOUT_STEPS : SANDBOX_REHEARSAL_STEPS,
  };
}

/**
 * @param {{ execute?: boolean, fullCloseout?: boolean, canaryPath?: string, maxStageCycles?: number }} [options]
 */
export async function runWorkflowSandboxRehearsal(options = {}) {
  const execute = options.execute ?? false;
  const fullCloseout = options.fullCloseout ?? false;
  const canaryPath =
    options.canaryPath ?? buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs([])).canaryPath;
  const maxStageCycles =
    options.maxStageCycles ??
    (fullCloseout ? FULL_LIVE_CAMPAIGN_STAGE_CYCLES : DEFAULT_LIVE_MAX_STAGE_CYCLES);
  const steps = fullCloseout ? SANDBOX_FULL_CLOSEOUT_STEPS : SANDBOX_REHEARSAL_STEPS;

  const checklist = await runWorkflowSandboxChecklist({ live: execute, canaryPath });
  if (!checklist.ok) {
    return { ok: false, mode: execute ? "live" : "offline", step: "preflight", checklist };
  }

  if (!execute) {
    const plan = buildOfflineRehearsalPlan(canaryPath, { fullCloseout });
    return {
      ok: plan.ok,
      mode: fullCloseout ? "offline-full-closeout" : "offline-rehearsal",
      canaryPath,
      steps,
      checklist,
      plan,
      nextSteps: fullCloseout
        ? [
            "npm run check:sandbox-rehearsal",
            "npm run check:sandbox-evidence",
            "npm run check:sandbox-checklist -- --live",
            "node scripts/workflow-sandbox-rehearsal.mjs --full-closeout --execute",
          ]
        : [
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

  let humanReview;
  if (fullCloseout) {
    if (
      !campaignResult.campaign.completed ||
      campaignResult.campaign.currentStageId !== HERMES_FINAL_STAGE_ID
    ) {
      return {
        ok: false,
        mode: "live-execute",
        canaryPath,
        steps,
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
        error: `campaign must reach ${HERMES_FINAL_STAGE_ID} before human review`,
      };
    }
    const reviewConfig = parseWorkflowSandboxCanaryArgs(baseCanaryArgv(canaryPath, ["--human-review"]));
    const reviewResult = await runHumanFinalReview(reviewConfig);
    humanReview = {
      verdict: reviewResult.review?.verdict,
      reviewArtifactPath: reviewResult.review?.reviewArtifactPath,
      ledgerHash: reviewResult.review?.ledgerHash,
    };
  }

  const ok =
    Boolean(applyResult.state?.workflowRunId) &&
    Boolean(campaignResult.campaign) &&
    campaignResult.plan.deliveryPolicy.productionAllowed === false &&
    (!fullCloseout || humanReview?.verdict === "approved");

  let closeoutEvidence;
  if (ok && fullCloseout) {
    closeoutEvidence = await runSandboxCloseoutEvidence({
      capture: true,
      canaryPath,
    });
  }

  return {
    ok: ok && (!closeoutEvidence || closeoutEvidence.ok),
    mode: fullCloseout ? "live-full-closeout" : "live-execute",
    canaryPath,
    steps,
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
    humanReview,
    closeoutEvidence,
  };
}

async function main() {
  const { execute, fullCloseout, json, maxStageCycles, canaryPath } = parseWorkflowSandboxRehearsalArgs();
  const report = await runWorkflowSandboxRehearsal({ execute, fullCloseout, maxStageCycles, canaryPath });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`mode: ${report.mode}`);
    for (const step of report.steps ?? SANDBOX_REHEARSAL_STEPS) {
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
