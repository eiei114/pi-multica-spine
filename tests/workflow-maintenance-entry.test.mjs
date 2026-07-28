import assert from "node:assert/strict";
import test from "node:test";

import { buildProductionRunPlan } from "../lib/workflow-production-run.ts";
import {
  parseWorkflowMaintenanceEntryArgs,
  runWorkflowMaintenanceEntry,
  validateMaintenanceBrief,
} from "../scripts/workflow-maintenance-entry.mjs";

test("parseWorkflowMaintenanceEntryArgs defaults to offline json", () => {
  const args = parseWorkflowMaintenanceEntryArgs([]);
  assert.equal(args.execute, false);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
});

test("validateMaintenanceBrief rejects empty and short briefs", () => {
  assert.equal(validateMaintenanceBrief("").ok, false);
  assert.equal(validateMaintenanceBrief("too short").ok, false);
  assert.equal(validateMaintenanceBrief("Bump docs and CI for maintenance lane entry").ok, true);
});

test("runWorkflowMaintenanceEntry offline plan passes in CI", async () => {
  const report = await runWorkflowMaintenanceEntry({
    maintenanceBrief: "Refresh README workflow ops section and add maintenance slash entry smoke",
  });
  assert.equal(report.ok, true);
  assert.equal(report.mode, "offline-plan");
  assert.equal(report.repoPath, buildProductionRunPlan().repoPath);
  assert.equal(report.plan.deliveryPolicy.productionAllowed, false);
  assert.equal(report.skillCommand, "/skill:maintenance-build");
});

test("runWorkflowMaintenanceEntry execute path supports smoke adapters", async () => {
  const calls = [];
  const report = await runWorkflowMaintenanceEntry({
    execute: true,
    repoPath: "C:/repo-smoke",
    maintenanceBrief: "Refresh maintenance live execute smoke coverage",
    maxStageCycles: 3,
    loadProductionRunState: async (repoPath) => {
      calls.push({ fn: "load", repoPath });
      return { parentIssueId: "existing-parent" };
    },
    startProductionWorkflowRun: async (config) => {
      calls.push({ fn: "start", config });
      return {
        state: {
          projectId: config.projectId,
          parentIdentifier: "DOT-SMOKE",
          workflowRunId: "prod-smoke-12345678",
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
          stages: [{ stageId: "capture" }, { stageId: "question_resolution" }],
          stopReason: "smoke_limit",
        },
      };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.mode, "live-start");
  assert.equal(report.parentReused, true);
  assert.equal(report.workflowRunId, "prod-smoke-12345678");
  assert.equal(report.campaign.stageCount, 2);
  assert.deepEqual(calls.map((call) => call.fn), ["load", "start", "campaign"]);
  assert.equal(calls[1].config.start, true);
  assert.equal(calls[2].config.campaign, true);
  assert.equal(calls[2].config.maxStageCycles, 3);
});
