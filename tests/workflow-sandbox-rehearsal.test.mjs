import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfflineRehearsalPlan,
  parseWorkflowSandboxRehearsalArgs,
  runWorkflowSandboxRehearsal,
  SANDBOX_REHEARSAL_STEPS,
} from "../scripts/workflow-sandbox-rehearsal.mjs";

test("parseWorkflowSandboxRehearsalArgs defaults to offline json", () => {
  const args = parseWorkflowSandboxRehearsalArgs([]);
  assert.equal(args.execute, false);
  assert.equal(args.json, true);
});

test("buildOfflineRehearsalPlan wires apply and campaign modes", () => {
  const plan = buildOfflineRehearsalPlan("/tmp/canary-rehearsal");
  assert.equal(plan.ok, true);
  assert.equal(plan.dryPlan.mode, "dry-run");
  assert.equal(plan.applyPlan.mode, "apply");
  assert.equal(plan.campaignPlan.mode, "campaign");
  assert.deepEqual(plan.steps, SANDBOX_REHEARSAL_STEPS);
});

test("runWorkflowSandboxRehearsal offline mode passes in CI", async () => {
  const report = await runWorkflowSandboxRehearsal({ execute: false });
  assert.equal(report.mode, "offline-rehearsal");
  assert.equal(report.ok, true);
  assert.equal(report.plan.ok, true);
});
