#!/usr/bin/env node
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";
const libs = await importSpineLibs(import.meta.url, ["idea-entry-config.ts","idea-session-inventory.ts","operations-view.ts","operations-renderer.ts","operations-hydration.ts","retention-classifier.ts"]);
const { resolveIdeaEntryConfig, readInventoryOrRebuild, IdeaSessionInventoryStore, buildOperationsViewV1, decodeOperationsCursor, WorkflowOperationsError, mapWorkflowOperationsError, wrapUnknownOperationsError, renderOperationsReport, runBoundedHydration, DEFAULT_HYDRATION_BUDGET, buildRetentionDryRunReport } = libs;

export function parseWorkflowIdeaStatusArgs(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false }, plain: { type: "boolean", default: false }, verbose: { type: "boolean", default: false }, refresh: { type: "boolean", default: false }, rebuild: { type: "boolean", default: false }, all: { type: "boolean", default: false }, "no-color": { type: "boolean", default: false }, "retention-dry-run": { type: "boolean", default: false }, "workflow-run-id": { type: "string" }, cursor: { type: "string" }, "vault-root": { type: "string" }, "sessions-root": { type: "string" }, help: { type: "boolean", default: false } }, allowPositionals: false, strict: true });
  if (positionals.length) throw new WorkflowOperationsError("CONFIG_ERROR", `Unknown arguments: ${positionals.join(" ")}`);
  return { json: values.json || !values.plain, verbose: values.verbose, refresh: values.refresh, rebuild: values.rebuild, all: values.all, noColor: values["no-color"], retentionDryRun: values["retention-dry-run"], workflowRunId: values["workflow-run-id"], cursor: values.cursor, vaultRoot: values["vault-root"], sessionsRoot: values["sessions-root"], help: values.help };
}

export async function runWorkflowIdeaStatus(options = {}) {
  if (options.help) return { ok: true, help: ["/skill:idea-status","/skill:idea-status --workflow-run-id <id>","/skill:idea-status --refresh","/skill:idea-status --retention-dry-run","/skill:idea-status --json"] };
  const config = await resolveIdeaEntryConfig({ flagVaultRoot: options.vaultRoot, flagSessionsRoot: options.sessionsRoot, cwd: options.cwd });
  const sessionsRoot = config.sessionsRoot ?? options.cwd ?? process.cwd();
  const store = new IdeaSessionInventoryStore(sessionsRoot);
  const inventory = options.rebuild ? await store.rebuildAndSwap() : await readInventoryOrRebuild(sessionsRoot);
  if (!inventory?.records) throw new WorkflowOperationsError("CORRUPT_INVENTORY", "Idea session inventory is missing or corrupt");
  let hydration;
  if (options.refresh || options.workflowRunId) {
    const targets = options.workflowRunId ? inventory.records.filter((record) => record.workflowRunId === options.workflowRunId) : inventory.records.slice(0, 4);
    hydration = (await runBoundedHydration(targets.map((record) => ({ sourceId: record.workflowRunId ?? record.sessionId, run: async () => record })), DEFAULT_HYDRATION_BUDGET, options.abortSignal)).results.map((item) => item.result);
  }
  const cursor = options.cursor ? decodeOperationsCursor(options.cursor) : undefined;
  if (cursor && cursor.inventoryGeneration !== inventory.generation) throw new WorkflowOperationsError("CURSOR_MISMATCH", "Inventory generation changed; restart without cursor");
  const view = buildOperationsViewV1({ command: options.retentionDryRun ? "idea-status --retention-dry-run" : "idea-status", inventory, hydration, workflowRunId: options.workflowRunId, retentionDryRun: options.retentionDryRun, cursor, pageSize: options.all ? inventory.records.length : 20, now: options.now });
  let retention;
  if (options.retentionDryRun) {
    retention = await buildRetentionDryRunReport(options.workflowRunId ? inventory.records.filter((record) => record.workflowRunId === options.workflowRunId) : inventory.records, inventory.generation, { syntheticExternalEvidenceFor: options.syntheticExternalEvidenceFor });
    view.exitCode = retention.exitCode; view.retentionBanner = retention.banner;
  }
  return { ok: true, view, retention, inventory, config };
}

async function main() {
  try {
    const args = parseWorkflowIdeaStatusArgs();
    const report = await runWorkflowIdeaStatus({ ...args, cwd: process.cwd(), now: new Date().toISOString() });
    if (report.help) { console.log(report.help.join("\n")); return; }
    process.stdout.write(renderOperationsReport(report.view, { json: args.json, verbose: args.verbose, isTty: process.stdout.isTTY, columns: process.stdout.columns, noColor: args.noColor }));
    if (args.retentionDryRun && report.retention && !args.json) process.stdout.write(`\nELIGIBLE FOR FUTURE RELEASE C REVIEW: ${report.retention.eligible.length}\nBLOCKED: ${report.retention.blocked.length}\nUNKNOWN: ${report.retention.unknown.length}\n${report.retention.banner}\n`);
    process.exitCode = report.view.exitCode;
  } catch (error) {
    const view = mapWorkflowOperationsError(wrapUnknownOperationsError(error));
    process.stdout.write(renderOperationsReport(view, { json: true }));
    process.exitCode = view.exitCode;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
