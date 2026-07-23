#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_THRESHOLDS = {
  lines: 70,
  branches: 60,
  functions: 75,
};

function testArgs() {
  return readdirSync("tests")
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `tests/${name}`);
}

export function parseCoverageSummary(output) {
  const rows = [...output.matchAll(/^ℹ\s+([\w./-]+\.ts)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/gm)];
  const scoped = rows.filter(([, file]) => file.startsWith("lib/") || file === "index.ts");
  if (scoped.length === 0) {
    throw new Error("could not parse lib/extensions TypeScript coverage rows");
  }
  const totals = scoped.reduce(
    (acc, [, , lines, branches, functions]) => ({
      lines: acc.lines + Number(lines),
      branches: acc.branches + Number(branches),
      functions: acc.functions + Number(functions),
      count: acc.count + 1,
    }),
    { lines: 0, branches: 0, functions: 0, count: 0 },
  );
  return {
    lines: totals.lines / totals.count,
    branches: totals.branches / totals.count,
    functions: totals.functions / totals.count,
    fileCount: totals.count,
  };
}

export function evaluateCoverage(summary, thresholds = DEFAULT_THRESHOLDS) {
  const failures = [];
  if (summary.lines < thresholds.lines) failures.push(`lines ${summary.lines.toFixed(2)}% < ${thresholds.lines}%`);
  if (summary.branches < thresholds.branches) failures.push(`branches ${summary.branches.toFixed(2)}% < ${thresholds.branches}%`);
  if (summary.functions < thresholds.functions) failures.push(`functions ${summary.functions.toFixed(2)}% < ${thresholds.functions}%`);
  return { ok: failures.length === 0, failures, summary, thresholds };
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
  if (!gate.ok) {
    console.error(gate.failures.join("\n"));
    console.error(`coverage summary (${summary.fileCount} ts files): lines=${summary.lines.toFixed(2)}% branches=${summary.branches.toFixed(2)}% functions=${summary.functions.toFixed(2)}%`);
    return 1;
  }
  console.log(`coverage gate ok (${summary.fileCount} ts files): lines=${summary.lines.toFixed(2)}% branches=${summary.branches.toFixed(2)}% functions=${summary.functions.toFixed(2)}%`);
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runCoverageGate(process.argv[2]);
}
