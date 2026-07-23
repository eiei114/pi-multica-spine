import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWorkflowSandboxChecklistArgs,
  runWorkflowSandboxChecklist,
} from "../scripts/workflow-sandbox-checklist.mjs";

test("parseWorkflowSandboxChecklistArgs defaults to offline json mode", () => {
  const args = parseWorkflowSandboxChecklistArgs([]);
  assert.equal(args.live, false);
  assert.equal(args.json, true);
  assert.equal(parseWorkflowSandboxChecklistArgs(["--live", "--plain"]).live, true);
});

test("runWorkflowSandboxChecklist passes offline preflight after build", async () => {
  const report = await runWorkflowSandboxChecklist({ live: false });
  assert.equal(report.mode, "offline");
  assert.equal(report.ok, true);
  assert.ok(report.checks.some((item) => item.id === "sandbox-dry-run-plan" && item.ok));
  assert.ok(report.checks.some((item) => item.id === "blocked-project-guard" && item.ok));
});
