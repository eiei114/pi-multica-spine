#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_THRESHOLDS = {
  lines: 75,
  branches: 68,
  functions: 75,
};

/** Per-file floors for high-risk modules (R-MNT-13). */
export const COVERAGE_HOTSPOTS = {
  "lib/hash.ts": { lines: 95, branches: 90, functions: 95 },
  "lib/state-machine.ts": { lines: 95, branches: 85, functions: 95 },
  "lib/jsonl-digest.ts": { lines: 90, branches: 80, functions: 85 },
  "lib/workflow-run-state.ts": { lines: 85, branches: 80, functions: 85 },
  "lib/project-workflow-binding.ts": { lines: 90, branches: 60, functions: 95 },
  "lib/npm-publish-classify.ts": { lines: 80, branches: 70, functions: 95 },
};

/** Integration-heavy files: excluded from hotspot line enforcement (report-only). */
export const COVERAGE_DENYLIST = new Set([
  "lib/workflow-sandbox-fixtures.ts",
  "lib/workflow-sandbox-campaign.ts",
  "lib/workflow-controller-autopilot.ts",
]);

/** Branch coverage floors for sandbox/campaign modules (R-MNT-20). */
export const COVERAGE_SANDBOX_BRANCH_FLOORS = {
  "lib/workflow-sandbox-campaign.ts": 65,
  "lib/workflow-sandbox-fixtures.ts": 30,
  "lib/workflow-controller-autopilot.ts": 75,
  "lib/workflow-sandbox-human-review.ts": 30,
};

/** Line coverage floors for sandbox/campaign modules (R-MNT-24). */
export const COVERAGE_SANDBOX_LINE_FLOORS = {
  "lib/workflow-sandbox-campaign.ts": 88,
  "lib/workflow-sandbox-fixtures.ts": 50,
  "lib/workflow-controller-autopilot.ts": 74,
  "lib/workflow-sandbox-human-review.ts": 93,
};

/** Function coverage floors for sandbox/campaign modules (R-MNT-27). */
export const COVERAGE_SANDBOX_FUNCTION_FLOORS = {
  "lib/workflow-sandbox-campaign.ts": 88,
  "lib/workflow-sandbox-fixtures.ts": 60,
  "lib/workflow-controller-autopilot.ts": 78,
  "lib/workflow-sandbox-human-review.ts": 95,
};

/** Function coverage floors for Pi extension entry (R-MNT-30). */
export const COVERAGE_EXTENSION_FUNCTION_FLOORS = {
  "extensions/index.ts": 74,
};

/** Line coverage floors for Pi extension entry (R-MNT-32). */
export const COVERAGE_RELEASE_A_SAFETY_FLOORS = {
  "lib/idea-entry-human.ts": { lines: 100, branches: 55, functions: 100 },
  "lib/idea-entry-config.ts": { lines: 98, branches: 94, functions: 100 },
  "lib/idea-entry-reservation.ts": { lines: 100, branches: 85, functions: 100 },
  "lib/idea-session-manifest.ts": { lines: 100, branches: 75, functions: 83 },
  "lib/idea-local-artifact.ts": { lines: 90, branches: 70, functions: 90 },
  "lib/portfolio-queue.ts": { lines: 85, branches: 70, functions: 85 },
  "lib/promotion-receipt.ts": { lines: 85, branches: 70, functions: 85 },
  "lib/build-template-catalog.ts": { lines: 90, branches: 65, functions: 90 },
  "lib/scaffold-resolution.ts": { lines: 80, branches: 60, functions: 80 },
  "lib/portfolio-delivery-lifecycle.ts": { lines: 85, branches: 65, functions: 85 },
  "lib/portfolio-fleet-enablement.ts": { lines: 85, branches: 65, functions: 85 },
  "lib/idea-auto-promotion.ts": { lines: 75, branches: 55, functions: 75 },
  "lib/vault-idea-note.ts": { lines: 100, branches: 74, functions: 100 },
  "lib/operations-view.ts": { lines: 100, branches: 84, functions: 88 },
  "lib/operations-renderer.ts": { lines: 100, branches: 76, functions: 100 },
  "lib/operations-hydration.ts": { lines: 100, branches: 73, functions: 61 },
  "lib/retention-classifier.ts": { lines: 95, branches: 52, functions: 83 },
  "lib/workflow-human-final-review-journal.ts": { lines: 99, branches: 85, functions: 95 },
};

export const COVERAGE_EXTENSION_LINE_FLOORS = {
  "extensions/index.ts": 74,
};

function testArgs() {
  return readdirSync("tests")
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `tests/${name}`);
}

export function parseCoverageFileRows(output) {
  const rows = [];
  let section = "";
  for (const line of output.split("\n")) {
    const topSection = line.match(/^ℹ ([\w-]+)\s+\|/);
    if (topSection && !topSection[1].includes(".")) {
      const name = topSection[1];
      section = name === "lib" || name === "extensions" ? name : "";
      continue;
    }
    const fileMatch = line.match(/^ℹ  ([\w./-]+\.ts)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
    if (!fileMatch) continue;
    let file = fileMatch[1];
    if (!file.includes("/") && section === "lib") {
      file = `lib/${file}`;
    }
    if (!file.includes("/") && section === "extensions") {
      file = `extensions/${file}`;
    }
    if (file.startsWith("lib/") || file.startsWith("extensions/")) {
      rows.push({
        file,
        lines: Number(fileMatch[2]),
        branches: Number(fileMatch[3]),
        functions: Number(fileMatch[4]),
      });
    }
  }
  return rows;
}

export function parseCoverageSummary(output) {
  const files = parseCoverageFileRows(output);
  if (files.length === 0) {
    throw new Error("could not parse lib/extensions TypeScript coverage rows");
  }
  const totals = files.reduce(
    (acc, row) => ({
      lines: acc.lines + row.lines,
      branches: acc.branches + row.branches,
      functions: acc.functions + row.functions,
      count: acc.count + 1,
    }),
    { lines: 0, branches: 0, functions: 0, count: 0 },
  );
  return {
    lines: totals.lines / totals.count,
    branches: totals.branches / totals.count,
    functions: totals.functions / totals.count,
    fileCount: totals.count,
    files,
  };
}

export function evaluateCoverage(summary, thresholds = DEFAULT_THRESHOLDS) {
  const failures = [];
  if (summary.lines < thresholds.lines) failures.push(`lines ${summary.lines.toFixed(2)}% < ${thresholds.lines}%`);
  if (summary.branches < thresholds.branches) failures.push(`branches ${summary.branches.toFixed(2)}% < ${thresholds.branches}%`);
  if (summary.functions < thresholds.functions) failures.push(`functions ${summary.functions.toFixed(2)}% < ${thresholds.functions}%`);
  return { ok: failures.length === 0, failures, summary, thresholds };
}

export function evaluateCoverageExtensionLines(files, floors = COVERAGE_EXTENSION_LINE_FLOORS) {
  const byFile = new Map(files.map((row) => [row.file, row]));
  const failures = [];
  const watched = [];
  for (const [file, minimum] of Object.entries(floors)) {
    const row = byFile.get(file);
    if (!row) {
      failures.push(`${file}: missing from coverage report`);
      continue;
    }
    watched.push(file);
    if (row.lines < minimum) {
      failures.push(`${file}: lines ${row.lines.toFixed(2)}% < ${minimum}%`);
    }
  }
  return { ok: failures.length === 0, failures, watched };
}

export function evaluateCoverageExtensionFunctions(files, floors = COVERAGE_EXTENSION_FUNCTION_FLOORS) {
  const byFile = new Map(files.map((row) => [row.file, row]));
  const failures = [];
  const watched = [];
  for (const [file, minimum] of Object.entries(floors)) {
    const row = byFile.get(file);
    if (!row) {
      failures.push(`${file}: missing from coverage report`);
      continue;
    }
    watched.push(file);
    if (row.functions < minimum) {
      failures.push(`${file}: functions ${row.functions.toFixed(2)}% < ${minimum}%`);
    }
  }
  return { ok: failures.length === 0, failures, watched };
}

export function evaluateCoverageSandboxFunctions(files, floors = COVERAGE_SANDBOX_FUNCTION_FLOORS) {
  const byFile = new Map(files.map((row) => [row.file, row]));
  const failures = [];
  const watched = [];
  for (const [file, minimum] of Object.entries(floors)) {
    const row = byFile.get(file);
    if (!row) {
      failures.push(`${file}: missing from coverage report`);
      continue;
    }
    watched.push(file);
    if (row.functions < minimum) {
      failures.push(`${file}: functions ${row.functions.toFixed(2)}% < ${minimum}%`);
    }
  }
  return { ok: failures.length === 0, failures, watched };
}

export function evaluateCoverageSandboxLines(files, floors = COVERAGE_SANDBOX_LINE_FLOORS) {
  const byFile = new Map(files.map((row) => [row.file, row]));
  const failures = [];
  const watched = [];
  for (const [file, minimum] of Object.entries(floors)) {
    const row = byFile.get(file);
    if (!row) {
      failures.push(`${file}: missing from coverage report`);
      continue;
    }
    watched.push(file);
    if (row.lines < minimum) {
      failures.push(`${file}: lines ${row.lines.toFixed(2)}% < ${minimum}%`);
    }
  }
  return { ok: failures.length === 0, failures, watched };
}

export function evaluateCoverageSandboxBranches(files, floors = COVERAGE_SANDBOX_BRANCH_FLOORS) {
  const byFile = new Map(files.map((row) => [row.file, row]));
  const failures = [];
  const watched = [];
  for (const [file, minimum] of Object.entries(floors)) {
    const row = byFile.get(file);
    if (!row) {
      failures.push(`${file}: missing from coverage report`);
      continue;
    }
    watched.push(file);
    if (row.branches < minimum) {
      failures.push(`${file}: branches ${row.branches.toFixed(2)}% < ${minimum}%`);
    }
  }
  return { ok: failures.length === 0, failures, watched };
}

export function evaluateCoverageHotspots(files, hotspots = COVERAGE_HOTSPOTS, denylist = COVERAGE_DENYLIST) {
  const byFile = new Map(files.map((row) => [row.file, row]));
  const failures = [];
  const watched = [];
  for (const [file, floors] of Object.entries(hotspots)) {
    if (denylist.has(file)) continue;
    const row = byFile.get(file);
    if (!row) {
      failures.push(`${file}: missing from coverage report`);
      continue;
    }
    watched.push(file);
    if (row.lines < floors.lines) failures.push(`${file}: lines ${row.lines.toFixed(2)}% < ${floors.lines}%`);
    if (row.branches < floors.branches) failures.push(`${file}: branches ${row.branches.toFixed(2)}% < ${floors.branches}%`);
    if (row.functions < floors.functions) failures.push(`${file}: functions ${row.functions.toFixed(2)}% < ${floors.functions}%`);
  }
  return { ok: failures.length === 0, failures, watched, denylist: [...denylist] };
}

export function runCoverageGate(inputPath) {
  let output;
  if (inputPath) {
    output = readFileSync(inputPath, "utf8");
  } else {
    const result = spawnSync(
      process.execPath,
      ["--experimental-test-coverage", "--test", ...testArgs()],
      { encoding: "utf8" },
    );
    output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status !== 0) {
      console.error(output);
      return result.status ?? 1;
    }
  }
  const summary = parseCoverageSummary(output);
  const gate = evaluateCoverage(summary);
  const hotspots = evaluateCoverageHotspots(summary.files ?? parseCoverageFileRows(output));
  const sandboxBranches = evaluateCoverageSandboxBranches(summary.files ?? parseCoverageFileRows(output));
  const sandboxLines = evaluateCoverageSandboxLines(summary.files ?? parseCoverageFileRows(output));
  const sandboxFunctions = evaluateCoverageSandboxFunctions(summary.files ?? parseCoverageFileRows(output));
  const extensionFunctions = evaluateCoverageExtensionFunctions(summary.files ?? parseCoverageFileRows(output));
  const releaseASafety = evaluateCoverageHotspots(summary.files ?? parseCoverageFileRows(output), COVERAGE_RELEASE_A_SAFETY_FLOORS, new Set());
  const extensionLines = evaluateCoverageExtensionLines(summary.files ?? parseCoverageFileRows(output));
  if (!gate.ok) {
    console.error(gate.failures.join("\n"));
    console.error(`coverage summary (${summary.fileCount} ts files): lines=${summary.lines.toFixed(2)}% branches=${summary.branches.toFixed(2)}% functions=${summary.functions.toFixed(2)}%`);
    return 1;
  }
  if (!hotspots.ok) {
    console.error("coverage hotspot failures:");
    console.error(hotspots.failures.join("\n"));
    return 1;
  }
  if (!sandboxBranches.ok) {
    console.error("coverage sandbox branch failures:");
    console.error(sandboxBranches.failures.join("\n"));
    return 1;
  }
  if (!sandboxLines.ok) {
    console.error("coverage sandbox line failures:");
    console.error(sandboxLines.failures.join("\n"));
    return 1;
  }
  if (!sandboxFunctions.ok) {
    console.error("coverage sandbox function failures:");
    console.error(sandboxFunctions.failures.join("\n"));
    return 1;
  }
  if (!extensionFunctions.ok) {
    console.error("coverage extension function failures:");
    console.error(extensionFunctions.failures.join("\n"));
    return 1;
  }
  if (!releaseASafety.ok) {
    console.error("coverage release-a safety failures:");
    console.error(releaseASafety.failures.join("\n"));
    return 1;
  }
  if (!extensionLines.ok) {
    console.error("coverage extension line failures:");
    console.error(extensionLines.failures.join("\n"));
    return 1;
  }
  console.log(
    `coverage gate ok (${summary.fileCount} ts files): lines=${summary.lines.toFixed(2)}% branches=${summary.branches.toFixed(2)}% functions=${summary.functions.toFixed(2)}%; hotspots=${hotspots.watched.length} sandboxBranches=${sandboxBranches.watched.length} sandboxLines=${sandboxLines.watched.length} sandboxFunctions=${sandboxFunctions.watched.length} extensionFunctions=${extensionFunctions.watched.length} extensionLines=${extensionLines.watched.length} denylist=${hotspots.denylist.length}`,
  );
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runCoverageGate(process.argv[2]);
}
