import assert from "node:assert/strict";
import test from "node:test";

import {
  devRangeMatchesBaseline,
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

test("devRangeMatchesBaseline validates the whole dev range, not a substring", () => {
  for (const range of ["1.5.0", "1.5.12", "~1.5.0", "1.5.x", "1.5.0-beta.1"]) {
    assert.equal(devRangeMatchesBaseline(range, "1.5"), true, range);
  }
  for (const range of ["1.50.0", "1.5.0 || 1.4.0", "^1.5.0", ">=1.5.0", "11.5.0", "1.4.0", "", undefined]) {
    assert.equal(devRangeMatchesBaseline(range, "1.5"), false, String(range));
  }
});

test("evaluatePiPeerVersions rejects dev ranges that only contain the baseline minor", () => {
  const pkg = "@earendil-works/pi-ai";
  const result = evaluatePiPeerVersions(
    { peerDependencies: { [pkg]: "*" }, devDependencies: { [pkg]: "1.50.0" } },
    { piPeerBaseline: "1.5.x", piPeerPackages: [pkg], expectedPeerMajor: "1.5" },
  );
  assert.equal(result.ok, false);
});

test("evaluateTemplateResyncRule flags missing publish curl pre-check", async () => {
  const rule = TEMPLATE_RESYNC_RULES.find((item) => item.id === "publish-curl-precheck");
  const result = await evaluateTemplateResyncRule(rule, async () => "name: Publish\n");
  assert.equal(result.ok, false);
});

test("setup-node guardrails track both workflows at the current major", async () => {
  const setupNodeRules = TEMPLATE_RESYNC_RULES.filter((item) => item.pattern && /setup-node@v\d+/.test(String(item.pattern)));
  assert.deepEqual(setupNodeRules.map((item) => item.id).sort(), ["ci-setup-node-v7", "publish-setup-node-v7"]);
  for (const rule of setupNodeRules) {
    assert.match(String(rule.pattern), /setup-node@v7/);
  }

  const staleCi = "      - uses: actions/setup-node@v6\n";
  const stalePublish = "        uses: actions/setup-node@v6\n";
  const ciRule = setupNodeRules.find((item) => item.id === "ci-setup-node-v7");
  const publishRule = setupNodeRules.find((item) => item.id === "publish-setup-node-v7");
  assert.equal((await evaluateTemplateResyncRule(ciRule, async () => staleCi)).ok, false);
  assert.equal((await evaluateTemplateResyncRule(publishRule, async () => stalePublish)).ok, false);
});
