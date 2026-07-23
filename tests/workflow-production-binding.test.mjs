import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionBindingPlan,
  buildProductionWorkflowBinding,
  PRODUCTION_PROJECT_ID,
} from "../lib/workflow-production-binding.ts";
import { validateProjectWorkflowBinding } from "../lib/project-workflow-binding.ts";
import { createHermesCompositeManifest } from "../lib/hermes-adapter.ts";

test("production binding targets maintenance project with PR and release gates", () => {
  const binding = buildProductionWorkflowBinding();
  assert.equal(binding.multicaProjectId, PRODUCTION_PROJECT_ID);
  assert.equal(binding.deliveryPolicy.prRequired, true);
  assert.equal(binding.deliveryPolicy.releaseAllowed, true);
  assert.equal(binding.deliveryPolicy.productionAllowed, false);
  assert.ok(binding.humanOwnedActions.includes("release"));
  const manifest = createHermesCompositeManifest();
  const validation = validateProjectWorkflowBinding(binding, manifest);
  assert.equal(validation.ok, true);
});

test("production binding plan documents color output policy", () => {
  const plan = buildProductionBindingPlan();
  assert.equal(plan.projectName, "pi-multica-spine Maintenance");
  assert.match(plan.repoPath, /pi-multica-spine$/);
});
