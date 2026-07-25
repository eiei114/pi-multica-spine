#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const { IdeaLocalLaneStore, createExplicitPortfolioPromotionFactory, loadExplicitPortfolioPromotionFactoryConfig, createHermesCompositeManifest, resolveNextHermesStageTarget, seedWorkflowStageLive, sha256Hex } = await importSpineLibs(import.meta.url, ["idea-local-lane.ts", "portfolio-promotion-factory.ts", "hermes-adapter.ts", "workflow-controller.ts", "hash.ts"]);
function required(a,f){const i=a.indexOf(f),v=i<0?undefined:a[i+1];if(!v||v.startsWith("--"))throw new Error(`${f} is required`);return v;}
function outputName(manifest, stageId, attempt){const base=manifest.stages.find(s=>s.stageId===stageId)?.outputs?.[0];if(!base)throw new Error(`Unknown stage output: ${stageId}`);return attempt===1?base:base.replace(/\.md$/,`-attempt-${attempt}.md`);}

export async function ingestPortfolioStage(input){
 if(!input.apply)throw new Error("Stage ingestion requires explicit --apply");
 const config=await loadExplicitPortfolioPromotionFactoryConfig(input.factoryConfigPath);const lane=await new IdeaLocalLaneStore(input.canaryPath).load();
 if(!lane?.implementationProjectId||lane.status!=="promoted"||lane.implementationProjectId!==config.supervisedPilot?.projectId)throw new Error("Stage ingestion requires exact promoted lane");
 const deps=createExplicitPortfolioPromotionFactory({cwd:input.canaryPath,config});const binding=await deps.bindingStore.getByProjectId(lane.implementationProjectId);let ledger=await deps.runStore.load(lane.workflowRunId);const stage=ledger?.stages[input.stageId];
 if(!binding||!ledger||!stage?.issueId||stage.issueId!==input.stageIssueId||stage.attempt!==Number(input.attempt)||ledger.currentStageId!==input.stageId)throw new Error("Stage ingestion identity mismatch");
 if(input.stageId==="spec_review")throw new Error("Use workflow-portfolio-review-ingest for spec_review decisions");
 const content=await readFile(input.outputPath,"utf8"),outputHash=sha256Hex(content),manifest=createHermesCompositeManifest();const name=outputName(manifest,input.stageId,stage.attempt);const artifactPath=posix.join(binding.artifactRoot,ledger.workflowRunId,name),physical=join(input.canaryPath,artifactPath);
 const prior=[...ledger.artifacts].reverse().find(a=>a.status==="immutable"&&a.stageId!==input.stageId);if(!prior)throw new Error("Stage ingestion requires prior immutable artifact lineage");
 if(input.dryRun)return {mode:"dry_run",stageId:input.stageId,artifactPath,outputHash,inputArtifactHash:prior.outputHash,next:resolveNextHermesStageTarget({...ledger,stages:{...ledger.stages,[input.stageId]:{...stage,status:"accepted"}}},manifest,binding)};
 await mkdir(dirname(physical),{recursive:true});await writeFile(physical,content,"utf8");
 ledger=await deps.runStore.upsertStage(lane.workflowRunId,{...stage,status:"produced",artifactHashes:[outputHash]});
 ledger=await deps.runStore.recordArtifact(lane.workflowRunId,{artifactSchemaVersion:1,workflowRunId:lane.workflowRunId,stageId:input.stageId,producerIssueId:input.stageIssueId,producerRunId:input.stageTaskId,attempt:stage.attempt,adapterBundleHash:ledger.adapterBundleHash,inputArtifactHashes:[prior.outputHash],outputPath:artifactPath,outputHash,status:"immutable"});
 ledger=await deps.runStore.upsertStage(lane.workflowRunId,{...ledger.stages[input.stageId],status:"accepted"});const next=resolveNextHermesStageTarget(ledger,manifest,binding);if(!next)return {mode:"accepted",artifactPath,outputHash};
 const seeded=await seedWorkflowStageLive({ledger,manifest,binding,parentIssueId:input.parentIssueId,stageId:next.stageId,attempt:next.attempt,liveCli:deps.liveCli});await deps.runStore.upsertStage(lane.workflowRunId,seeded.stage);return {mode:"advanced",artifactPath,outputHash,nextStage:seeded};
}
if(import.meta.url===(process.argv[1]?pathToFileURL(process.argv[1]).href:"")){const a=process.argv.slice(2);ingestPortfolioStage({canaryPath:required(a,"--canary-path"),factoryConfigPath:required(a,"--factory-config"),outputPath:required(a,"--output"),stageIssueId:required(a,"--stage-issue"),stageTaskId:required(a,"--stage-task"),parentIssueId:required(a,"--parent-issue"),stageId:required(a,"--stage"),attempt:required(a,"--attempt"),apply:a.includes("--apply"),dryRun:a.includes("--dry-run")}).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
