import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfflineRehearsalPlan,
  FULL_LIVE_CAMPAIGN_STAGE_CYCLES,
  parseWorkflowSandboxRehearsalArgs,
  runWorkflowSandboxRehearsal,
  SANDBOX_FULL_CLOSEOUT_STEPS,
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

test("buildOfflineRehearsalPlan wires full closeout modes", () => {
  const plan = buildOfflineRehearsalPlan("/tmp/canary-rehearsal", { fullCloseout: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.humanReviewPlan?.mode, "human-review");
  assert.equal(plan.maxStageCycles, FULL_LIVE_CAMPAIGN_STAGE_CYCLES);
  assert.deepEqual(plan.steps, SANDBOX_FULL_CLOSEOUT_STEPS);
});

test("runWorkflowSandboxRehearsal offline full closeout passes in CI", async () => {
  const report = await runWorkflowSandboxRehearsal({ execute: false, fullCloseout: true });
  assert.equal(report.mode, "offline-full-closeout");
  assert.equal(report.ok, true);
});
