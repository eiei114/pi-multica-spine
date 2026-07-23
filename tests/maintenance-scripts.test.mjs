import assert from "node:assert/strict";
import test from "node:test";

import { validateChangelog } from "../scripts/check-changelog.mjs";
import { evaluateCoverage, parseCoverageSummary } from "../scripts/coverage-gate.mjs";

test("validateChangelog accepts current changelog shape", () => {
  const content = `## [Unreleased]\n\n## [0.6.0] - 2026-07-24\n\n### Added\n- item\n`;
  const result = validateChangelog(content);
  assert.equal(result.ok, true);
});

test("validateChangelog rejects missing Unreleased", () => {
  const result = validateChangelog("## [0.6.0] - 2026-07-24\n");
  assert.equal(result.ok, false);
});

test("parseCoverageSummary averages lib and extension ts files", () => {
  const output = [
    "ℹ  lib/foo.ts                         |  80.00 |    70.00 |   90.00 |",
    "ℹ  index.ts                          |  70.00 |    50.00 |   80.00 |",
    "ℹ  workflow-sandbox-campaign.js       |   3.50 |   100.00 |    0.00 | ignored",
  ].join("\n");
  const summary = parseCoverageSummary(output);
  assert.equal(summary.fileCount, 2);
  assert.equal(summary.lines, 75);
});

test("evaluateCoverage enforces thresholds", () => {
  const pass = evaluateCoverage({ lines: 76, branches: 69, functions: 79 });
  assert.equal(pass.ok, true);
  const fail = evaluateCoverage({ lines: 65, branches: 69, functions: 79 });
  assert.equal(fail.ok, false);
});
