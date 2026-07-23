#!/usr/bin/env node
/**
 * Offline Hermes Campaign walkthrough: catalog → binding → ledger → full campaign → human review.
 * Uses fixture WorkflowLiveCli (no Multica network / CLI).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHermesCompositeManifest, HERMES_FINAL_STAGE_ID } from "../../lib/hermes-adapter.ts";
import { ProjectWorkflowBindingStore } from "../../lib/project-workflow-binding-store.ts";
import { WorkflowCatalogStore } from "../../lib/workflow-catalog-store.ts";
import {
  hashWorkflowRunLedger,
  WorkflowRunStateStore,
} from "../../lib/workflow-run-state.ts";
import { runCanaryCampaign } from "../../lib/workflow-sandbox-campaign.ts";
import { completeHumanFinalReview } from "../../lib/workflow-sandbox-human-review.ts";

import {
  bootstrapWalkthroughRepo,
  buildWalkthroughBinding,
  createFixtureLiveCli,
} from "./fixture-live-cli.mjs";

const WALKTHROUGH_PROJECT_ID = "walkthrough-proj-001";
const WALKTHROUGH_PARENT_ISSUE = "parent_walkthrough";
const WALKTHROUGH_RUN_ID = "walkthrough-run-001";
/** Enough cycles to reach `final_package` without manual ledger seeding (R-MNT-16). */
export const FULL_OFFLINE_CAMPAIGN_STAGE_CYCLES = 80;

async function bootstrapCatalog(catalogStore, manifest) {
  await catalogStore.upsert(manifest, "quarantined");
  await catalogStore.transition(manifest.adapterId, manifest.adapterVersion, "audited");
  return catalogStore.transition(manifest.adapterId, manifest.adapterVersion, "active");
}

export async function runWorkflowCampaignWalkthrough(options = {}) {
  const maxStageCycles = options.maxStageCycles ?? FULL_OFFLINE_CAMPAIGN_STAGE_CYCLES;
  const includeHumanReview = options.includeHumanReview ?? true;
  const walkthroughRoot =
    options.root ??
    (await mkdtemp(join(tmpdir(), "pi-spine-campaign-walkthrough-")));

  await bootstrapWalkthroughRepo(walkthroughRoot);

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

  const liveCli = createFixtureLiveCli(WALKTHROUGH_PROJECT_ID, WALKTHROUGH_PARENT_ISSUE);

  const campaign = await runCanaryCampaign(
    {
      canaryPath: walkthroughRoot,
      projectId: WALKTHROUGH_PROJECT_ID,
      parentIssueId: WALKTHROUGH_PARENT_ISSUE,
      workflowRunId: WALKTHROUGH_RUN_ID,
    },
    {
      liveCli,
      runStore,
      roughIdea:
        "Offline walkthrough: exercise Hermes capture → final_package with fixture WorkflowLiveCli.",
      maxStageCycles,
    },
  );

  let humanReview;
  if (includeHumanReview) {
    if (!campaign.completed || campaign.currentStageId !== HERMES_FINAL_STAGE_ID) {
      throw new Error(
        `campaign must complete at ${HERMES_FINAL_STAGE_ID} before human review (got ${campaign.currentStageId}, stop=${campaign.stopReason})`,
      );
    }
    humanReview = await completeHumanFinalReview(
      {
        canaryPath: walkthroughRoot,
        projectId: WALKTHROUGH_PROJECT_ID,
        parentIssueId: WALKTHROUGH_PARENT_ISSUE,
        workflowRunId: WALKTHROUGH_RUN_ID,
      },
      {
        verdict: "approved",
        reviewer: "walkthrough-offline",
        notes: "Offline human final review after full campaign reached final_package.",
      },
      {
        liveCli,
        runStore,
        reviewArtifactPath: join(
          walkthroughRoot,
          ".multica-spine/walkthrough-artifacts",
          WALKTHROUGH_RUN_ID,
          "final",
          "10-human-final-review.md",
        ),
      },
    );
  }

  const ledger = await runStore.load(WALKTHROUGH_RUN_ID);
  if (!ledger) throw new Error("ledger missing after campaign");

  const ledgerHash = hashWorkflowRunLedger(ledger);
  const ok =
    catalogEntry.status === "active" &&
    campaign.completed &&
    campaign.currentStageId === HERMES_FINAL_STAGE_ID &&
    ledger.workflowStatus === "completed" &&
    !binding.deliveryPolicy.productionAllowed &&
    (!includeHumanReview || humanReview?.verdict === "approved");

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
    humanReview: humanReview
      ? {
          verdict: humanReview.verdict,
          reviewer: "walkthrough-offline",
          reviewArtifactPath: humanReview.reviewArtifactPath,
          ledgerHash: humanReview.ledgerHash,
        }
      : undefined,
    ledgerHash,
  };
}

const summary = await runWorkflowCampaignWalkthrough();
console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exitCode = 1;
}
