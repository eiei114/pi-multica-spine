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
