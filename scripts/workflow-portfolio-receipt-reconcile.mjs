#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const { PromotionReceiptStore, createExplicitPortfolioPromotionFactory, loadExplicitPortfolioPromotionFactoryConfig } = await importSpineLibs(import.meta.url, ["promotion-receipt.ts", "portfolio-promotion-factory.ts"]);

function required(argv, flag) { const i = argv.indexOf(flag); const value = i < 0 ? undefined : argv[i + 1]; if (!value || value.startsWith("--")) throw new Error(`${flag} is required`); return value; }

export async function reconcilePortfolioReceipt(input) {
  if (!input.apply) throw new Error("Receipt reconciliation requires explicit --apply");
  const config = await loadExplicitPortfolioPromotionFactoryConfig(input.factoryConfigPath);
  if (!config.supervisedPilot || input.expectedProjectId !== config.supervisedPilot.projectId) throw new Error("Receipt reconciliation Project identity mismatch");
  const deps = createExplicitPortfolioPromotionFactory({ cwd: input.canaryPath, config });
  const project = (await deps.projects.list()).find((item) => item.id === input.expectedProjectId);
  if (!project || project.status !== "in_progress") throw new Error("Receipt reconciliation requires exact in_progress Project");
  const store = new PromotionReceiptStore(input.canaryPath, input.sessionId);
  const receipt = await store.load();
  if (!receipt || receipt.identities.projectId !== project.id) throw new Error("Receipt reconciliation identity mismatch");
  if (input.dryRun) return { mode: "dry_run", receiptStatus: receipt.status, blockedReason: receipt.blockedReason, projectId: project.id };
  const reconciled = await store.reconcileCompleted();
  return { mode: "reconciled", receipt: reconciled, projectId: project.id };
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  const a = process.argv.slice(2);
  reconcilePortfolioReceipt({ canaryPath: required(a, "--canary-path"), factoryConfigPath: required(a, "--factory-config"), sessionId: required(a, "--session"), expectedProjectId: required(a, "--project-id"), apply: a.includes("--apply"), dryRun: a.includes("--dry-run") }).then((x) => console.log(JSON.stringify(x, null, 2))).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
