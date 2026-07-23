import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTemplateResyncRule,
  runTemplateResyncCheck,
  TEMPLATE_RESYNC_RULES,
} from "../scripts/template-resync-check.mjs";

test("runTemplateResyncCheck passes on current repo baseline", async () => {
  const report = await runTemplateResyncCheck();
  assert.equal(report.ok, true, report.failures.join("; "));
  assert.equal(report.results.length, TEMPLATE_RESYNC_RULES.length);
});

test("evaluateTemplateResyncRule flags missing publish curl pre-check", async () => {
  const rule = TEMPLATE_RESYNC_RULES.find((item) => item.id === "publish-curl-precheck");
  const result = await evaluateTemplateResyncRule(rule, async () => "name: Publish\n");
  assert.equal(result.ok, false);
});
