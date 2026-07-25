#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const {
  IdeaLocalLaneStore,
  PromotionReceiptStore,
  createExplicitPortfolioPromotionFactory,
  loadExplicitPortfolioPromotionFactoryConfig,
  seedWorkflowStageLive,
  sha256Hex,
} = await importSpineLibs(import.meta.url, [
  "idea-local-lane.ts",
  "promotion-receipt.ts",
  "portfolio-promotion-factory.ts",
  "workflow-controller.ts",
  "hash.ts",
]);

function required(argv, flag) {
  const index = argv.indexOf(flag);
  const value = index < 0 ? undefined : argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} is required`);
  return value;
}

export async function retryPortfolioSpecReview(input) {
  if (!input.apply) throw new Error("Review retry requires explicit --apply");
  const config = await loadExplicitPortfolioPromotionFactoryConfig(input.factoryConfigPath);
  if (!config.supervisedPilot) throw new Error("Review retry requires a supervisedPilot factory config");
  const lane = await new IdeaLocalLaneStore(input.canaryPath).load();
  if (!lane?.implementationProjectId || lane.status !== "promoted") throw new Error("Review retry requires a promoted local lane");
  if (lane.implementationProjectId !== config.supervisedPilot.projectId) throw new Error("Review retry Project identity mismatch");

  const reviewContent = await readFile(input.reviewInputPath, "utf8");
  const acceptanceCriteria = reviewContent.split(/\r?\n/)
    .map((line) => line.match(/^\s*- \[ \] (.+)$/)?.[1]).filter(Boolean);
  if (acceptanceCriteria.length === 0) throw new Error("Review retry input requires unchecked acceptance criteria");

  const deps = createExplicitPortfolioPromotionFactory({ cwd: input.canaryPath, config });
  const project = (await deps.projects.list()).find((item) => item.id === lane.implementationProjectId);
  if (!project || project.title !== config.supervisedPilot.projectTitle || project.status !== "in_progress") {
    throw new Error("Review retry requires the exact in_progress supervised Project");
  }
  const receipt = await new PromotionReceiptStore(input.canaryPath, lane.sessionId).load();
  const parentIssueId = receipt?.identities.parentIssueId;
  if (!parentIssueId) throw new Error("Review retry requires a receipt parent issue identity");
  const ledger = await deps.runStore.load(lane.workflowRunId);
  const prior = ledger?.stages.spec_review;
  if (!ledger || !prior?.issueId) throw new Error("Review retry requires a seeded prior spec_review stage");
  if (input.supersedeStageIssueId !== prior.issueId) throw new Error("Review retry requires explicit exact prior stage issue id");
  const binding = await deps.bindingStore.getByProjectId(project.id);
  if (!binding) throw new Error("Review retry requires persisted Project binding");

  const packet = [
    `review_input_path=${input.reviewInputPath}`,
    `review_input_hash=${sha256Hex(reviewContent)}`,
    "acceptance_criteria:",
    ...acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "review_input:", reviewContent,
  ].join("\n");
  const attempt = prior.attempt + 1;
  if (input.dryRun) return { mode: "dry_run", projectId: project.id, parentIssueId, supersededIssueId: prior.issueId, attempt, reviewInputHash: sha256Hex(reviewContent) };
  const seeded = await seedWorkflowStageLive({
    ledger, manifest: (await import("../lib/hermes-adapter.ts")).createHermesCompositeManifest(), binding,
    parentIssueId, stageId: "spec_review", attempt, titlePrefix: "Workflow retry", stageInput: packet, liveCli: deps.liveCli,
  });
  await deps.runStore.upsertStage(lane.workflowRunId, seeded.stage);
  return { mode: "seeded", projectId: project.id, parentIssueId, supersededIssueId: prior.issueId, attempt, issueId: seeded.issueId };
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  const argv = process.argv.slice(2);
  retryPortfolioSpecReview({
    canaryPath: required(argv, "--canary-path"), factoryConfigPath: required(argv, "--factory-config"), reviewInputPath: required(argv, "--review-input"),
    supersedeStageIssueId: required(argv, "--supersede-stage-issue"), apply: argv.includes("--apply"), dryRun: argv.includes("--dry-run"),
  }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
