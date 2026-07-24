#!/usr/bin/env node
/**
 * Offline CI guard for workflow-idea-entry: stable invocation token + stale scratch repair.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { importSpineLibs } from "./spine-lib-import.mjs";
import { buildFreshCanaryPath } from "./workflow-sandbox-canary.mjs";
import { runWorkflowIdeaEntry } from "./workflow-idea-entry.mjs";

const { readJsonFile } = await importSpineLibs(import.meta.url, ["json-file-store.ts"]);

export const CI_OFFLINE_IDEA_ENTRY = {
  roughIdea: "CI offline idea entry validation seed",
  sessionSuffix: "ci-offline-idea-entry-validation",
  sessionsRoot: ".ci-tmp/idea-sessions",
  invocationToken: "ci-offline-idea-entry-validation",
};

function manifestPathForCanary(canaryPath) {
  return join(canaryPath, ".multica-spine", "idea-session-manifest.json");
}

function reservationPathForToken(sessionsRoot, invocationToken) {
  return join(sessionsRoot, ".multica-spine", "idea-invocations", `${invocationToken}.json`);
}

export async function repairStaleCiIdeaEntryScratch(options = {}) {
  const config = { ...CI_OFFLINE_IDEA_ENTRY, ...options };
  const cwd = options.cwd ?? process.cwd();
  const sessionsRoot = join(cwd, config.sessionsRoot);
  const canaryPath = buildFreshCanaryPath(config.roughIdea, {
    sessionSuffix: config.sessionSuffix,
    sessionsRoot,
  });
  let repaired = false;

  const manifest = await readJsonFile(manifestPathForCanary(canaryPath));
  if (manifest && manifest.invocationToken !== config.invocationToken) {
    await rm(canaryPath, { recursive: true, force: true });
    repaired = true;
  }

  const reservationPath = reservationPathForToken(sessionsRoot, config.invocationToken);
  const reservation = await readJsonFile(reservationPath);
  if (!reservation?.canaryPath) {
    return { repaired, canaryPath };
  }

  const boundManifest = await readJsonFile(manifestPathForCanary(reservation.canaryPath));
  if (!boundManifest || boundManifest.invocationToken !== config.invocationToken) {
    await rm(reservationPath, { force: true });
    return { repaired: true, canaryPath };
  }

  return { repaired, canaryPath };
}

export async function runCiOfflineIdeaEntryCheck(options = {}) {
  const config = { ...CI_OFFLINE_IDEA_ENTRY, ...options };
  const cwd = options.cwd ?? process.cwd();
  await repairStaleCiIdeaEntryScratch({ ...config, cwd });
  return runWorkflowIdeaEntry({
    roughIdea: config.roughIdea,
    sessionSuffix: config.sessionSuffix,
    sessionsRoot: join(cwd, config.sessionsRoot),
    invocationToken: config.invocationToken,
    cwd,
  });
}

async function main() {
  const report = await runCiOfflineIdeaEntryCheck();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
