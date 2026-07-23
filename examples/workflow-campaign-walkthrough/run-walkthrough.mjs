#!/usr/bin/env node
/**
 * Offline Hermes Campaign walkthrough: catalog → binding → run ledger → stage artifacts.
 * Uses fixture WorkflowLiveCli (no Multica network / CLI).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHermesCompositeManifest } from "../../lib/hermes-adapter.ts";
import { ProjectWorkflowBindingStore } from "../../lib/project-workflow-binding-store.ts";
import { WorkflowCatalogStore } from "../../lib/workflow-catalog-store.ts";
import {
  hashWorkflowRunLedger,
  WorkflowRunStateStore,
} from "../../lib/workflow-run-state.ts";
import { runCanaryCampaign } from "../../lib/workflow-sandbox-campaign.ts";

import {
  buildWalkthroughBinding,
  createFixtureLiveCli,
} from "./fixture-live-cli.mjs";

const WALKTHROUGH_PROJECT_ID = "walkthrough-proj-001";
const WALKTHROUGH_PARENT_ISSUE = "parent_walkthrough";
const WALKTHROUGH_RUN_ID = "walkthrough-run-001";
const MAX_STAGE_CYCLES = 5;

async function bootstrapCatalog(catalogStore, manifest) {
  await catalogStore.upsert(manifest, "quarantined");
  await catalogStore.transition(manifest.adapterId, manifest.adapterVersion, "audited");
  return catalogStore.transition(manifest.adapterId, manifest.adapterVersion, "active");
}

export async function runWorkflowCampaignWalkthrough(options = {}) {
  const maxStageCycles = options.maxStageCycles ?? MAX_STAGE_CYCLES;
  const walkthroughRoot =
    options.root ??
    (await mkdtemp(join(tmpdir(), "pi-spine-campaign-walkthrough-")));

  const manifest = createHermesCompositeManifest();
  const binding = buildWalkthroughBinding(WALKTHROUGH_PROJECT_ID, manifest);

  if (binding.deliveryPolicy.productionAllowed) {
    throw new Error("walkthrough binding must keep productionAllowed=false");
  }

  const catalogStore = new WorkflowCatalogStore(walkthroughRoot);
  const catalogEntry = await bootstrapCatalog(catalogStore, manifest);
  await new ProjectWorkflowBindingStore(walkthroughRoot).save(binding);

  const runStore = new WorkflowRunStateStore(walkthroughRoot);
  await runStore.create({
    workflowRunId: WALKTHROUGH_RUN_ID,
    multicaProjectId: WALKTHROUGH_PROJECT_ID,
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    adapterBundleHash: manifest.derivedBundleHash,
    executionMode: binding.executionMode,
    initialStageId: "capture",
  });

  await runStore.upsertStage(WALKTHROUGH_RUN_ID, {
    stageId: "capture",
    status: "seeded",
    attempt: 1,
    issueId: "issue_capture",
    assignedAgentId: "agent_walkthrough",
    artifactHashes: [],
  });

  const campaign = await runCanaryCampaign(
    {
      canaryPath: walkthroughRoot,
      projectId: WALKTHROUGH_PROJECT_ID,
      parentIssueId: WALKTHROUGH_PARENT_ISSUE,
      workflowRunId: WALKTHROUGH_RUN_ID,
    },
    {
      liveCli: createFixtureLiveCli(WALKTHROUGH_PROJECT_ID, WALKTHROUGH_PARENT_ISSUE),
      runStore,
      roughIdea:
        "Offline walkthrough: exercise Hermes capture → artifacts with fixture WorkflowLiveCli.",
      maxStageCycles,
    },
  );

  const ledger = await runStore.load(WALKTHROUGH_RUN_ID);
  if (!ledger) throw new Error("ledger missing after campaign");

  const ledgerHash = hashWorkflowRunLedger(ledger);
  const ok =
    catalogEntry.status === "active" &&
    campaign.stages.length >= 1 &&
    !binding.deliveryPolicy.productionAllowed;

  return {
    ok,
    walkthroughRoot,
    catalogStatus: catalogEntry.status,
    deliveryPolicy: binding.deliveryPolicy,
    campaign: {
      completed: campaign.completed,
      workflowStatus: campaign.workflowStatus,
      currentStageId: campaign.currentStageId,
      stageCount: campaign.stages.length,
      stages: campaign.stages.map((s) => s.stageId),
      stopReason: campaign.stopReason,
    },
    ledgerHash,
  };
}

const summary = await runWorkflowCampaignWalkthrough();
console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exitCode = 1;
}
