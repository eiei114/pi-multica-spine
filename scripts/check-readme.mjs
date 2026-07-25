#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FENCE = /^```/;

export function validateReadme(content, { version } = {}) {
  const errors = [];
  const fenceLines = content.split("\n").filter((line) => FENCE.test(line.trim()));
  if (fenceLines.length % 2 !== 0) {
    errors.push(`unbalanced fenced code blocks (${fenceLines.length} fence lines)`);
  }

  const pinMatch = content.match(/pi install npm:pi-multica-spine@(\d+\.\d+\.\d+)/);
  if (!pinMatch) {
    errors.push("missing install pin example: pi install npm:pi-multica-spine@<version>");
  } else if (version && pinMatch[1] !== version) {
    errors.push(`install pin example @${pinMatch[1]} does not match package.json version ${version}`);
  }

  if (/``npm run ci`/.test(content)) {
    errors.push("Development section has malformed backticks around npm run ci");
  }

  if (/productionAllowed=false\)\.\n\n```\n\nInstall into the current project/.test(content)) {
    errors.push("stray fenced-code closer after maintenance-build entry skill");
  }

  return { ok: errors.length === 0, errors };
}

export function runCheckReadme({ readmePath = "README.md", packageJsonPath = "package.json" } = {}) {
  const content = readFileSync(readmePath, "utf8");
  let version;
  try {
    version = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
  } catch {
    // optional version alignment when package.json is unavailable
  }
  const result = validateReadme(content, { version });
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    return 1;
  }
  console.log(`readme ok (pin=@${version ?? "unknown"})`);
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runCheckReadme();
}
