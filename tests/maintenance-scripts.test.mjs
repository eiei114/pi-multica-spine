import assert from "node:assert/strict";
import test from "node:test";

import { validateChangelog } from "../scripts/check-changelog.mjs";
import {
  buildReadmeDocsSectionLine,
  extractCiCheckScripts,
  extractDevelopmentSection,
  extractOpenRoadmapSeeds,
  extractRegisteredToolNames,
  extractRoadmapDocumentedVersions,
  README_DOCS_SECTION_ENTRIES,
  validateCiReadmeAlignment,
  validateReadme,
  validateReadmeDocsSectionAlignment,
  validateReadmeToolAlignment,
  validateRoadmapFreshness,
  runCheckReadme,
} from "../scripts/check-readme.mjs";
import {
  evaluateCoverage,
  evaluateCoverageExtensionFunctions,
  evaluateCoverageExtensionLines,
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

const sampleCiScript = [
  "npm run build",
  "npm run check:coverage",
  "npm run check:readme",
  "npm run check:idea-entry",
].join(" && ");

const sampleCiDescription = [
  "`npm run ci` runs build, typecheck, `check:coverage`, `check:readme`, `check:idea-entry`.",
].join("\n");

const sampleReadme = [
  "Pin a specific version when you want reproducible installs:",
  "",
  "```bash",
  "pi install npm:pi-multica-spine@0.12.7",
  "```",
  "",
  "## Development",
  "",
  sampleCiDescription,
].join("\n");

const sampleRoadmap = [
  "# Roadmap",
  "",
  "## Current release status",
  "",
  "| Item | Value |",
  "| --- | --- |",
  "| Published version | **0.12.7** (npm) |",
  "| Working-tree version | `0.12.7` |",
  "",
  "## Candidate maintenance seeds",
  "",
  "| ID | Task | Est. | Why needed |",
  "| --- | --- | --- | --- |",
  "| R-MNT-45 | First scoped task | ~30 min | Keeps the first lane healthy |",
  "| R-MNT-46 | Second scoped task | ~45 min | Keeps the second lane healthy |",
  "| R-MNT-47 | Third scoped task | ~60 min | Keeps the third lane healthy |",
  "",
  "## Completed seeds (reference)",
].join("\n");

test("extractCiCheckScripts returns check:* scripts from package ci", () => {
  assert.deepEqual(extractCiCheckScripts(sampleCiScript), [
    "check:coverage",
    "check:readme",
    "check:idea-entry",
  ]);
});

test("validateCiReadmeAlignment accepts aligned ci description", () => {
  const result = validateCiReadmeAlignment(sampleReadme, sampleCiScript);
  assert.equal(result.ok, true);
});

test("validateCiReadmeAlignment rejects missing check scripts", () => {
  const result = validateCiReadmeAlignment(
    sampleReadme.replace("`check:idea-entry`", ""),
    sampleCiScript,
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /check:idea-entry/);
});

test("extractDevelopmentSection returns content until the next heading", () => {
  const section = extractDevelopmentSection(sampleReadme + "\n\n## License\n\nMIT");
  assert.match(section, /^## Development/);
  assert.match(section, /check:idea-entry/);
  assert.doesNotMatch(section, /## License/);
});

test("validateCiReadmeAlignment rejects ci description outside Development section", () => {
  const readmeWithMisplacedLine = [
    sampleCiDescription,
    "",
    "## Development",
    "",
    "Other development notes.",
  ].join("\n");
  const result = validateCiReadmeAlignment(readmeWithMisplacedLine, sampleCiScript);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Development section missing npm run ci description line/);
});

test("extractRegisteredToolNames returns multica tool names from extension source", () => {
  const source = [
    'name: "multica_spine_bind",',
    'name: "multica_workflow_route_preflight",',
  ].join("\n");
  assert.deepEqual(extractRegisteredToolNames(source), [
    "multica_spine_bind",
    "multica_workflow_route_preflight",
  ]);
});

test("validateReadmeDocsSectionAlignment accepts aligned workflow runbook entries", () => {
  const content = [
    "## Docs",
    ...README_DOCS_SECTION_ENTRIES.map((entry) => buildReadmeDocsSectionLine(entry)),
  ].join("\n");
  const result = validateReadmeDocsSectionAlignment(content);
  assert.equal(result.ok, true);
});

test("validateReadmeDocsSectionAlignment rejects concatenated runbook descriptions", () => {
  const content = [
    "## Docs",
    buildReadmeDocsSectionLine(README_DOCS_SECTION_ENTRIES[0]),
    buildReadmeDocsSectionLine(README_DOCS_SECTION_ENTRIES[1]),
    `${buildReadmeDocsSectionLine(README_DOCS_SECTION_ENTRIES[2])} — live sandbox \`--execute\` path — daily sandbox / Maintenance rehearsal path`,
  ].join("\n");
  const result = validateReadmeDocsSectionAlignment(content);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /workflow-production-live-execute-runbook\.md/);
});

test("validateReadmeDocsSectionAlignment ignores matching entries outside Docs section", () => {
  const content = [
    "## Docs",
    buildReadmeDocsSectionLine(README_DOCS_SECTION_ENTRIES[0]),
    buildReadmeDocsSectionLine(README_DOCS_SECTION_ENTRIES[1]),
    "## Examples",
    buildReadmeDocsSectionLine(README_DOCS_SECTION_ENTRIES[2]),
  ].join("\n");
  const result = validateReadmeDocsSectionAlignment(content);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /workflow-production-live-execute-runbook\.md/);
});

test("validateReadmeToolAlignment rejects missing registered tool references", () => {
  const extensionSource = 'name: "multica_workflow_telemetry_record"';
  const result = validateReadmeToolAlignment("# README", extensionSource);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /multica_workflow_telemetry_record/);
});

test("validateReadme fails when registered tool validation is required without extension source", () => {
  const result = validateReadme(sampleReadme, {
    version: "0.12.7",
    ciScript: sampleCiScript,
    validateRegisteredTools: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /extension entry source required/);
});

test("runCheckReadme fails when extension entry is unavailable", () => {
  const exitCode = runCheckReadme({
    readmePath: "README.md",
    packageJsonPath: "package.json",
    extensionPath: "extensions/__missing-index.ts",
  });
  assert.equal(exitCode, 1);
});

test("extractRoadmapDocumentedVersions returns both current version markers", () => {
  assert.deepEqual(extractRoadmapDocumentedVersions(sampleRoadmap), {
    published: "0.12.7",
    workingTree: "0.12.7",
  });
});

test("extractOpenRoadmapSeeds ignores completed entries and parses scope columns", () => {
  const roadmap = sampleRoadmap.replace(
    "| R-MNT-47 | Third scoped task | ~60 min | Keeps the third lane healthy |",
    "| ~~R-MNT-47~~ | Completed task | ~60 min | Already shipped |",
  );
  assert.deepEqual(extractOpenRoadmapSeeds(roadmap), [
    { id: "R-MNT-45", task: "First scoped task", estimate: "~30 min", scopeNote: "Keeps the first lane healthy" },
    { id: "R-MNT-46", task: "Second scoped task", estimate: "~45 min", scopeNote: "Keeps the second lane healthy" },
  ]);
});

test("validateRoadmapFreshness accepts aligned versions and three scoped seeds", () => {
  const result = validateRoadmapFreshness(sampleRoadmap, "0.12.7");
  assert.equal(result.ok, true);
  assert.equal(result.scopedSeeds.length, 3);
});

test("validateRoadmapFreshness rejects version drift", () => {
  const roadmap = sampleRoadmap.replace("| Working-tree version | `0.12.7` |", "| Working-tree version | `0.12.6` |");
  const result = validateRoadmapFreshness(roadmap, "0.12.7");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Working-tree version 0\.12\.6 does not match package\.json version 0\.12\.7/);
});

test("validateRoadmapFreshness rejects too few or unscoped open seeds", () => {
  const roadmap = sampleRoadmap
    .replace("| R-MNT-46 | Second scoped task | ~45 min | Keeps the second lane healthy |", "")
    .replace("| R-MNT-47 | Third scoped task | ~60 min | Keeps the third lane healthy |", "| R-MNT-47 | Third scoped task | ~60 min | |\n");
  const result = validateRoadmapFreshness(roadmap, "0.12.7");
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /missing scope notes.*R-MNT-47/);
  assert.match(result.errors.join("\n"), /at least 3 open seed entries with scope notes; found 1/);
});

test("validateReadme accepts current README and roadmap shape", () => {
  const result = validateReadme(sampleReadme, {
    version: "0.12.7",
    ciScript: sampleCiScript,
    roadmapContent: sampleRoadmap,
  });
  assert.equal(result.ok, true);
});

test("validateReadme rejects unbalanced fences and stale pin", () => {
  const content = [
    "```bash",
    "pi install npm:pi-multica-spine@0.8.0",
    "```",
    "",
    "### Idea-to-build entry skill",
    "",
    "```bash",
    "open block",
  ].join("\n");
  const result = validateReadme(content, { version: "0.12.7" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unbalanced/);
  assert.match(result.errors.join("\n"), /0\.8\.0/);
});

test("validateReadme rejects malformed npm run ci backticks", () => {
  const content = [
    "```bash",
    "pi install npm:pi-multica-spine@0.12.7",
    "```",
    "",
    "``npm run ci` runs build.",
  ].join("\n");
  const result = validateReadme(content, { version: "0.12.7" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /malformed backticks around npm run ci/);
});

test("validateReadme rejects stray fence closer after maintenance-build entry skill", () => {
  const content = [
    "```bash",
    "pi install npm:pi-multica-spine@0.12.7",
    "```",
    "",
    "productionAllowed=false).",
    "",
    "```",
    "",
    "Install into the current project",
  ].join("\n");
  const result = validateReadme(content, { version: "0.12.7" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /stray fenced-code closer after maintenance-build entry skill/);
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

test("evaluateCoverageExtensionLines enforces extension entry line floors", () => {
  const pass = evaluateCoverageExtensionLines([
    { file: "extensions/index.ts", lines: 75, branches: 68, functions: 76 },
  ]);
  assert.equal(pass.ok, true);
  const fail = evaluateCoverageExtensionLines([
    { file: "extensions/index.ts", lines: 70, branches: 68, functions: 76 },
  ]);
  assert.equal(fail.ok, false);
});

test("evaluateCoverageExtensionFunctions enforces extension entry function floors", () => {
  const pass = evaluateCoverageExtensionFunctions([
    { file: "extensions/index.ts", lines: 75, branches: 68, functions: 76 },
  ]);
  assert.equal(pass.ok, true);
  const fail = evaluateCoverageExtensionFunctions([
    { file: "extensions/index.ts", lines: 75, branches: 68, functions: 70 },
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

test("parseCoverageFileRows prefixes extensions section rows", () => {
  const rows = parseCoverageFileRows(
    "ℹ extensions                          |        |          |         |\nℹ  index.ts                          |  70.00 |    50.00 |   80.00 |",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file, "extensions/index.ts");
});

test("parseCoverageFileRows ignores dist js rows", () => {
  const rows = parseCoverageFileRows("ℹ  lib/foo.ts | 80.00 | 70.00 | 90.00 |\nℹ  dist/lib/foo.js | 1.00 | 100.00 | 0.00 |");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].file, "lib/foo.ts");
});
