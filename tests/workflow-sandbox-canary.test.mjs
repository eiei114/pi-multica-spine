import assert from "node:assert/strict";
import test from "node:test";

import { buildSandboxCanaryPlan, parseWorkflowSandboxCanaryArgs } from "../scripts/workflow-sandbox-canary.mjs";

test("workflow sandbox canary dry-run emits plan without mutations", () => {
  const plan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(["--dry-run"]));
  assert.equal(plan.mode, "dry-run");
  assert.match(plan.canaryPath, /pi-multica-spine-idea-to-build-canary/);
  assert.equal(plan.deliveryPolicy.productionAllowed, false);
});

test("workflow sandbox canary rejects explicit project id on apply", () => {
  assert.throws(
    () => buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(["--apply", "--project-id", "prod_proj"])),
    /Refusing sandbox command/,
  );
});

test("workflow sandbox canary report mode is side-effect free", () => {
  const plan = buildSandboxCanaryPlan(parseWorkflowSandboxCanaryArgs(["--report"]));
  assert.equal(plan.mode, "report");
  assert.equal(plan.finalPackageFiles.length, 10);
});
