#!/usr/bin/env node
/**
 * Release A live sandbox smoke (#66): offline-safe closeout path in a temp workspace.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runWorkflowIdeaEntry } from "./workflow-idea-entry.mjs";
import { runWorkflowIdeaStatus } from "./workflow-idea-status.mjs";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "pi-multica-spine-live-smoke-"));
  const sessionsRoot = join(root, "sessions");
  const vaultRoot = join(root, "vault");
  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(vaultRoot, { recursive: true });
  await writeFile(join(root, ".pi-idea-entry.json"), JSON.stringify({ sessionsRoot, vaultRoot }, null, 2) + "\n", "utf8");

  const entry = await runWorkflowIdeaEntry({
    roughIdea: "Live sandbox smoke validation seed for Release A closeout",
    sessionSuffix: "live-smoke",
    cwd: root,
    projectConfigPath: join(root, ".pi-idea-entry.json"),
  });
  if (!entry.ok || entry.mode !== "offline-plan") {
    throw new Error(`idea entry smoke failed: ${JSON.stringify(entry)}`);
  }

  const status = await runWorkflowIdeaStatus({
    cwd: root,
    sessionsRoot,
    rebuild: true,
    json: true,
    now: new Date().toISOString(),
  });
  if (!status.ok || !["COMPLETE", "NO_MATCHES"].includes(status.view.dataState)) {
    throw new Error(`idea status smoke failed: ${JSON.stringify(status.view)}`);
  }

  const retention = await runWorkflowIdeaStatus({
    cwd: root,
    sessionsRoot,
    retentionDryRun: true,
    json: true,
    now: new Date().toISOString(),
  });
  if (!retention.ok || retention.view.retentionBanner !== "RETENTION DRY-RUN — NO FILES WERE DELETED") {
    throw new Error("retention dry-run smoke failed");
  }

  console.log(JSON.stringify({ ok: true, root, entrySessionId: entry.sessionId, status: status.view.dataState, inventoryTotal: status.view.summary.total }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  });
}
