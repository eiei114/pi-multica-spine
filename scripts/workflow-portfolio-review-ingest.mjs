#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const { IdeaLocalLaneStore, createExplicitPortfolioPromotionFactory, loadExplicitPortfolioPromotionFactoryConfig, createHermesCompositeManifest, evaluateHermesSpecReview, seedWorkflowStageLive, sha256Hex } = await importSpineLibs(import.meta.url, ["idea-local-lane.ts", "portfolio-promotion-factory.ts", "hermes-adapter.ts", "workflow-controller.ts", "hash.ts"]);

function required(argv, flag) { const i = argv.indexOf(flag); const v = i < 0 ? undefined : argv[i + 1]; if (!v || v.startsWith("--")) throw new Error(`${flag} is required`); return v; }

export async function ingestPortfolioSpecReview(input) {
  if (!input.apply) throw new Error("Review ingestion requires explicit --apply");
  const config = await loadExplicitPortfolioPromotionFactoryConfig(input.factoryConfigPath);
  const lane = await new IdeaLocalLaneStore(input.canaryPath).load();
  if (!lane?.implementationProjectId || lane.status !== "promoted" || lane.implementationProjectId !== config.supervisedPilot?.projectId) throw new Error("Review ingestion requires exact promoted supervised lane");
  const deps = createExplicitPortfolioPromotionFactory({ cwd: input.canaryPath, config });
  const binding = await deps.bindingStore.getByProjectId(lane.implementationProjectId);
  const ledger = await deps.runStore.load(lane.workflowRunId);
  const stage = ledger?.stages.spec_review;
  if (!binding || !ledger || !stage?.issueId || stage.issueId !== input.reviewIssueId || stage.attempt !== Number(input.attempt)) throw new Error("Review ingestion stage identity mismatch");
  if (input.verdict !== "pass") throw new Error("Review ingestion accepts only unqualified pass");
  const content = await readFile(input.reviewOutputPath, "utf8");
  const outputHash = sha256Hex(content);
  const outputPath = posix.join(binding.artifactRoot, ledger.workflowRunId, `06-spec-review-attempt-${stage.attempt}.md`);
  const physicalPath = join(input.canaryPath, outputPath);
  if (input.dryRun) return { mode: "dry_run", attempt: stage.attempt, outputPath, outputHash, nextStage: "implementation_plan" };
  await mkdir(dirname(physicalPath), { recursive: true });
  await writeFile(physicalPath, content, "utf8");
  let next = await deps.runStore.upsertStage(lane.workflowRunId, { ...stage, status: "produced", artifactHashes: [outputHash] });
  next = await deps.runStore.recordArtifact(lane.workflowRunId, {
    artifactSchemaVersion: 1, workflowRunId: lane.workflowRunId, stageId: "spec_review", producerIssueId: input.reviewIssueId,
    producerRunId: input.reviewTaskId, attempt: stage.attempt, adapterBundleHash: next.adapterBundleHash,
    inputArtifactHashes: ["85705ea255f3d648f1185c0e458eed5abdf613591d6faa8d2ef0e95f81ee4b2b"], outputPath, outputHash, status: "immutable",
  });
  const decision = evaluateHermesSpecReview(next, { stageId: "spec_review", attempt: stage.attempt, verdict: "pass", findingIds: [], reviewArtifactHash: outputHash });
  next = await deps.runStore.recordReview(lane.workflowRunId, decision.record);
  next = await deps.runStore.upsertStage(lane.workflowRunId, { ...next.stages.spec_review, status: "accepted" });
  const seeded = await seedWorkflowStageLive({ ledger: next, manifest: createHermesCompositeManifest(), binding, parentIssueId: input.parentIssueId, stageId: decision.nextStageId, attempt: 1, liveCli: deps.liveCli });
  await deps.runStore.upsertStage(lane.workflowRunId, seeded.stage);
  return { mode: "ingested", reviewArtifact: { outputPath, outputHash }, nextStage: seeded };
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  const a = process.argv.slice(2);
  ingestPortfolioSpecReview({ canaryPath: required(a,"--canary-path"), factoryConfigPath: required(a,"--factory-config"), reviewOutputPath: required(a,"--review-output"), reviewIssueId: required(a,"--review-issue"), reviewTaskId: required(a,"--review-task"), parentIssueId: required(a,"--parent-issue"), attempt: required(a,"--attempt"), verdict: required(a,"--verdict"), apply: a.includes("--apply"), dryRun: a.includes("--dry-run") }).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
