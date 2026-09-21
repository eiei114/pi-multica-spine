#!/usr/bin/env node
/**
 * Keep the maintenance entry documentation aligned with its executable policy.
 * This is intentionally a small, offline check so documentation drift is caught
 * before a maintenance workflow is handed to a human.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));

export const MAINTENANCE_ENTRY_COMMAND = "scripts/workflow-maintenance-entry.mjs";
export const MAINTENANCE_POLICY = "productionAllowed=false";

export const MAINTENANCE_ENTRY_DOCS = [
  "README.md",
  "skills/maintenance-build/SKILL.md",
  "docs/workflow-ops-checklist.md",
];

export async function checkMaintenanceEntryDocs(root = repoRoot) {
  const failures = [];
  for (const relativePath of MAINTENANCE_ENTRY_DOCS) {
    let content;
    try {
      content = await readFile(join(root, relativePath), "utf8");
    } catch (error) {
      failures.push(`${relativePath}: unable to read (${error.code ?? error.message})`);
      continue;
    }
    if (!content.includes(MAINTENANCE_ENTRY_COMMAND)) {
      failures.push(`${relativePath}: missing ${MAINTENANCE_ENTRY_COMMAND}`);
    }
    if (!content.includes(MAINTENANCE_POLICY)) {
      failures.push(`${relativePath}: missing ${MAINTENANCE_POLICY}`);
    }
  }

  const entryPath = join(root, MAINTENANCE_ENTRY_COMMAND);
  try {
    const entry = await readFile(entryPath, "utf8");
    if (!entry.includes("plan.deliveryPolicy.productionAllowed === false")) {
      failures.push(`${MAINTENANCE_ENTRY_COMMAND}: missing production policy guard`);
    }
    if (!entry.includes("--maintenance-brief")) {
      failures.push(`${MAINTENANCE_ENTRY_COMMAND}: missing maintenance brief option`);
    }
  } catch (error) {
    failures.push(`${MAINTENANCE_ENTRY_COMMAND}: unable to read (${error.code ?? error.message})`);
  }

  return { ok: failures.length === 0, failures };
}

async function main() {
  const result = await checkMaintenanceEntryDocs();
  if (result.ok) {
    console.log(`maintenance entry docs OK (${MAINTENANCE_ENTRY_DOCS.length} documents)`);
    return;
  }
  console.error("maintenance entry documentation drift detected:");
  for (const failure of result.failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

const entry = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (entry) await main();
