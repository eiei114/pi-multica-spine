import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePiPeerVersions,
  evaluateTemplateResyncRule,
  runTemplateResyncCheck,
  TEMPLATE_RESYNC_RULES,
} from "../scripts/template-resync-check.mjs";

test("runTemplateResyncCheck passes on current repo baseline", async () => {
  const report = await runTemplateResyncCheck();
  assert.equal(report.ok, true, report.failures.join("; "));
  assert.equal(report.results.length, TEMPLATE_RESYNC_RULES.length + 1);
});

test("evaluatePiPeerVersions flags drift from template peer baseline", () => {
  const result = evaluatePiPeerVersions({
    peerDependencies: { "@earendil-works/pi-ai": "^0.79.0" },
    devDependencies: { "@earendil-works/pi-ai": "^0.79.0" },
  });
  assert.equal(result.ok, false);
});

test("evaluateTemplateResyncRule flags missing publish curl pre-check", async () => {
  const rule = TEMPLATE_RESYNC_RULES.find((item) => item.id === "publish-curl-precheck");
  const result = await evaluateTemplateResyncRule(rule, async () => "name: Publish\n");
  assert.equal(result.ok, false);
});
