#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HEADING = /^## \[/;

export function validateChangelog(content) {
  const errors = [];
  if (!content.includes("## [Unreleased]")) {
    errors.push("missing ## [Unreleased] heading");
  }
  const dated = [...content.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/gm)];
  if (dated.length === 0) {
    errors.push("missing at least one dated release section");
  }
  for (const match of dated) {
    const [, version, date] = match;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`invalid date for version ${version}`);
    }
  }
  const headings = content.split("\n").filter((line) => HEADING.test(line));
  if (headings.length < 2) {
    errors.push("expected Unreleased plus at least one version heading");
  }
  return { ok: errors.length === 0, errors, releaseCount: dated.length };
}

export function runCheckChangelog(path = "CHANGELOG.md") {
  const content = readFileSync(path, "utf8");
  const result = validateChangelog(content);
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    return 1;
  }
  console.log(`changelog ok (${result.releaseCount} dated releases)`);
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  process.exitCode = runCheckChangelog(process.argv[2]);
}
