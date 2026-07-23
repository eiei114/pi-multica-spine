import assert from "node:assert/strict";
import test from "node:test";

import { validateChangelog } from "../scripts/check-changelog.mjs";
import {
  evaluateCoverage,
  evaluateCoverageHotspots,
  evaluateCoverageSandboxBranches,
  evaluateCoverageSandboxFunctions,
  evaluateCoverageSandboxLines,
  parseCoverageFileRows,
  parseCoverageSummary,
} from "../scripts/coverage-gate.mjs";

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
    "ℹ lib                                 |        |          |         |",
    "ℹ  foo.ts                            |  80.00 |    70.00 |   90.00 |",
    "ℹ extensions                          |        |          |         |",
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

test("evaluateCoverageHotspots enforces per-file floors", () => {
  const files = [
    { file: "lib/hash.ts", lines: 100, branches: 100, functions: 100 },
    { file: "lib/state-machine.ts", lines: 100, branches: 90, functions: 100 },
    { file: "lib/jsonl-digest.ts", lines: 96, branches: 86, functions: 88 },
    { file: "lib/workflow-run-state.ts", lines: 90, branches: 87, functions: 92 },
    { file: "lib/project-workflow-binding.ts", lines: 94, branches: 66, functions: 100 },
    { file: "lib/npm-publish-classify.ts", lines: 82, branches: 74, functions: 100 },
  ];
  const pass = evaluateCoverageHotspots(files);
  assert.equal(pass.ok, true);
  const fail = evaluateCoverageHotspots([
    ...files.filter((f) => f.file !== "lib/hash.ts"),
    { file: "lib/hash.ts", lines: 50, branches: 50, functions: 50 },
  ]);
  assert.equal(fail.ok, false);
});

test("evaluateCoverageSandboxBranches enforces sandbox module branch floors", () => {
  const files = [
    { file: "lib/workflow-sandbox-campaign.ts", lines: 90, branches: 68, functions: 90 },
    { file: "lib/workflow-sandbox-fixtures.ts", lines: 55, branches: 33, functions: 66 },
    { file: "lib/workflow-controller-autopilot.ts", lines: 76, branches: 78, functions: 80 },
    { file: "lib/workflow-sandbox-human-review.ts", lines: 96, branches: 36, functions: 100 },
  ];
  const pass = evaluateCoverageSandboxBranches(files);
  assert.equal(pass.ok, true);
  const fail = evaluateCoverageSandboxBranches([
    ...files.filter((f) => f.file !== "lib/workflow-sandbox-fixtures.ts"),
    { file: "lib/workflow-sandbox-fixtures.ts", lines: 55, branches: 20, functions: 66 },
  ]);
  assert.equal(fail.ok, false);
});

test("evaluateCoverageSandboxFunctions enforces sandbox module function floors", () => {
  const files = [
    { file: "lib/workflow-sandbox-campaign.ts", lines: 90, branches: 68, functions: 90 },
    { file: "lib/workflow-sandbox-fixtures.ts", lines: 55, branches: 33, functions: 66 },
    { file: "lib/workflow-controller-autopilot.ts", lines: 76, branches: 78, functions: 80 },
    { file: "lib/workflow-sandbox-human-review.ts", lines: 96, branches: 36, functions: 100 },
  ];
  const pass = evaluateCoverageSandboxFunctions(files);
  assert.equal(pass.ok, true);
  const fail = evaluateCoverageSandboxFunctions([
    ...files.filter((f) => f.file !== "lib/workflow-controller-autopilot.ts"),
    { file: "lib/workflow-controller-autopilot.ts", lines: 76, branches: 78, functions: 70 },
  ]);
  assert.equal(fail.ok, false);
});

test("evaluateCoverageSandboxLines enforces sandbox module line floors", () => {
  const files = [
    { file: "lib/workflow-sandbox-campaign.ts", lines: 90, branches: 68, functions: 90 },
    { file: "lib/workflow-sandbox-fixtures.ts", lines: 51, branches: 33, functions: 66 },
    { file: "lib/workflow-controller-autopilot.ts", lines: 76, branches: 78, functions: 80 },
    { file: "lib/workflow-sandbox-human-review.ts", lines: 95, branches: 36, functions: 100 },
  ];
  const pass = evaluateCoverageSandboxLines(files);
  assert.equal(pass.ok, true);
  const fail = evaluateCoverageSandboxLines([
    ...files.filter((f) => f.file !== "lib/workflow-sandbox-fixtures.ts"),
    { file: "lib/workflow-sandbox-fixtures.ts", lines: 40, branches: 33, functions: 66 },
  ]);
  assert.equal(fail.ok, false);
});

test("parseCoverageFileRows ignores dist js rows", () => {
  const rows = parseCoverageFileRows("ℹ  lib/foo.ts | 80.00 | 70.00 | 90.00 |\nℹ  dist/lib/foo.js | 1.00 | 100.00 | 0.00 |");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file, "lib/foo.ts");
});
