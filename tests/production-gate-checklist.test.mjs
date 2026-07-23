import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_GATE_CHECKLIST,
  parseProductionGateChecklistArgs,
  runProductionGateChecklist,
} from "../scripts/production-gate-checklist.mjs";

test("parseProductionGateChecklistArgs defaults to json", () => {
  const args = parseProductionGateChecklistArgs([]);
  assert.equal(args.json, true);
  assert.equal(parseProductionGateChecklistArgs(["--plain"]).json, false);
});

test("OPEN_GATE_CHECKLIST marks human gate items", () => {
  const human = OPEN_GATE_CHECKLIST.filter((item) => item.humanGate);
  assert.deepEqual(
    human.map((item) => item.id),
    ["written-intent", "rollback-owner"],
  );
});

test("runProductionGateChecklist offline keeps gate CLOSED", async () => {
  const report = await runProductionGateChecklist();
  assert.equal(report.gateStatus, "CLOSED");
  assert.equal(report.automatedPassed, true);
  assert.equal(report.ok, true);
  assert.equal(report.openGateReady, false);
  assert.ok(report.humanGateItems.length >= 2);
});
