#!/usr/bin/env node
/**
 * Offline-safe smoke for the maintenance entry --execute path (R-MNT-41).
 *
 * The real maintenance entry mutates Multica. This smoke injects deterministic
 * start/campaign adapters so CI can verify the live-start branch, argument
 * wiring, and productionAllowed=false policy without external side effects.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { PRODUCTION_PROJECT_ID } from "../lib/workflow-production-binding.ts";
import { runWorkflowMaintenanceEntry } from "./workflow-maintenance-entry.mjs";

export async function runWorkflowMaintenanceLiveExecuteSmoke() {
  const root = await mkdtemp(join(tmpdir(), "pi-multica-spine-maintenance-live-smoke-"));
  const repoPath = join(root, "maintenance-repo");
  await mkdir(repoPath, { recursive: true });

  const calls = [];
  const report = await runWorkflowMaintenanceEntry({
    execute: true,
    repoPath,
    maintenanceBrief: "Live maintenance entry execute smoke validates wiring only",
    maxStageCycles: 2,
    loadProductionRunState: async (path) => {
      calls.push({ fn: "load", repoPath: path });
      return undefined;
    },
    startProductionWorkflowRun: async (config) => {
      calls.push({ fn: "start", config });
      return {
        state: {
          repoPath: config.repoPath,
          projectId: config.projectId,
          parentIssueId: "issue-smoke-parent",
          parentIdentifier: "DOT-SMOKE",
          workflowRunId: "prod-smoke-00000000",
        },
      };
    },
    runProductionCampaign: async (config) => {
      calls.push({ fn: "campaign", config });
      return {
        campaign: {
          completed: false,
          workflowStatus: "waiting",
          currentStageId: "capture",
          stages: [{ stageId: "capture" }],
          stopReason: "smoke_max_stage_cycles",
        },
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.mode, "live-start");
  assert.equal(report.repoPath, repoPath);
  assert.equal(report.parentIdentifier, "DOT-SMOKE");
  assert.equal(report.workflowRunId, "prod-smoke-00000000");
  assert.equal(report.parentReused, false);
  assert.equal(report.projectId, PRODUCTION_PROJECT_ID);
  assert.equal(report.campaign.currentStageId, "capture");
  assert.equal(report.campaign.stageCount, 1);
  assert.equal(report.checklist.plan.deliveryPolicy.productionAllowed, false);
  assert.deepEqual(calls.map((call) => call.fn), ["load", "start", "campaign"]);
  assert.equal(calls[1].config.start, true);
  assert.equal(calls[2].config.campaign, true);
  assert.equal(calls[2].config.maxStageCycles, 2);

  return {
    ok: true,
    mode: report.mode,
    parentIdentifier: report.parentIdentifier,
    workflowRunId: report.workflowRunId,
    currentStageId: report.campaign.currentStageId,
    productionAllowed: report.checklist.plan.deliveryPolicy.productionAllowed,
  };
}

async function main() {
  const report = await runWorkflowMaintenanceLiveExecuteSmoke();
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
