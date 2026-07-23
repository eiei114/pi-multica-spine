import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfflineProductionRehearsalPlan,
  parseWorkflowProductionRehearsalArgs,
  PRODUCTION_REHEARSAL_STEPS,
  runWorkflowProductionRehearsal,
} from "../scripts/workflow-production-rehearsal.mjs";

test("parseWorkflowProductionRehearsalArgs defaults to offline json", () => {
  const args = parseWorkflowProductionRehearsalArgs([]);
  assert.equal(args.execute, false);
  assert.equal(args.json, true);
});

test("buildOfflineProductionRehearsalPlan wires maintenance modes", () => {
  const plan = buildOfflineProductionRehearsalPlan("/tmp/prod-repo");
  assert.equal(plan.ok, true);
  assert.equal(plan.plan.deliveryPolicy.productionAllowed, false);
  assert.equal(plan.modes.start, true);
  assert.equal(plan.modes.campaign, true);
  assert.equal(plan.modes.humanReview, true);
  assert.deepEqual(plan.steps, PRODUCTION_REHEARSAL_STEPS);
});

test("runWorkflowProductionRehearsal offline mode passes in CI", async () => {
  const report = await runWorkflowProductionRehearsal({ execute: false });
  assert.equal(report.mode, "offline-rehearsal");
  assert.equal(report.ok, true);
});
