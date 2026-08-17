#!/usr/bin/env node
/**
 * Offline CI guard for idea-session retention dry-run (R-MNT-42).
 * Validates classification output and banner; does not require exit 0 when sessions are unreviewed.
 */
import { pathToFileURL } from "node:url";

import { importSpineLibs } from "./spine-lib-import.mjs";
import { runWorkflowIdeaStatus } from "./workflow-idea-status.mjs";

const { IDEA_SESSION_RETENTION_DRY_RUN_BANNER } = await importSpineLibs(import.meta.url, ["idea-session-retention-policy.ts"]);

export async function runCiOfflineIdeaRetentionCheck(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const sessionsRoot = options.sessionsRoot ?? ".ci-tmp/idea-sessions";
  const report = await runWorkflowIdeaStatus({
    cwd,
    sessionsRoot,
    retentionDryRun: true,
    json: true,
    rebuild: true,
    now: new Date().toISOString(),
  });
  if (!report.ok || !report.retention) {
    throw new Error(`retention dry-run failed: ${JSON.stringify(report.view ?? report)}`);
  }
  if (report.view.retentionBanner !== IDEA_SESSION_RETENTION_DRY_RUN_BANNER) {
    throw new Error(`retention banner mismatch: ${report.view.retentionBanner}`);
  }
  if (![0, 1, 2].includes(report.retention.exitCode)) {
    throw new Error(`invalid retention exit code: ${report.retention.exitCode}`);
  }
  return {
    ok: true,
    exitCode: report.retention.exitCode,
    eligible: report.retention.eligible.length,
    blocked: report.retention.blocked.length,
    unknown: report.retention.unknown.length,
    total: report.view.summary.total,
  };
}

async function main() {
  const result = await runCiOfflineIdeaRetentionCheck();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
