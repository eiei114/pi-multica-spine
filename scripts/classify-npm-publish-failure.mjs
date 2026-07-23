#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { importSpineLib } from "./spine-lib-import.mjs";

const {
  classifyNpmPublishFailure,
  shouldTreatNpmPublishFailureAsSuccess,
} = await importSpineLib(import.meta.url, "npm-publish-classify.ts");

function readStderr(path) {
  return readFileSync(path, "utf8");
}

function localPackShasum() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
  const entries = JSON.parse(output);
  const entry = Array.isArray(entries) ? entries[0] : entries;
  return entry?.dist?.shasum;
}

function publishedShasum(name, version) {
  try {
    const output = execFileSync("npm", ["view", `${name}@${version}`, "dist.shasum", "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(output.trim());
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return undefined;
  }
}

export function runClassifyNpmPublishFailure(argv = process.argv.slice(2)) {
  const [stderrPath, packageJsonPath = "package.json"] = argv;
  if (!stderrPath) {
    console.error("usage: classify-npm-publish-failure <stderr-file> [package.json]");
    return 1;
  }
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const stderr = readStderr(stderrPath);
  const input = {
    stderr,
    localShasum: localPackShasum(),
    publishedShasum: publishedShasum(pkg.name, pkg.version),
  };
  const classification = classifyNpmPublishFailure(input);
  if (shouldTreatNpmPublishFailureAsSuccess(input)) {
    console.log(JSON.stringify({ classification, action: "skip_benign" }, null, 2));
    return 0;
  }
  console.error(JSON.stringify({ classification, action: "fail", stderr: stderr.slice(-2000) }, null, 2));
  return 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runClassifyNpmPublishFailure();
}
