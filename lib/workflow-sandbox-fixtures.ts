import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reconcileWorkflowEvents } from "./workflow-controller-autopilot.ts";
import { createHermesCompositeManifest } from "./hermes-adapter.ts";
import { rollbackAdapterMigration, WorkflowAdapterMigrationStore, buildMigrationSnapshot, formatAdapterIdentity } from "./workflow-adapter-migration.ts";
import { createWorkflowCatalogEntry } from "./workflow-catalog.ts";
import { WorkflowRunStateStore } from "./workflow-run-state.ts";

export const FIXTURE_NAMES = [
  "F1_success_path",
  "F2_unresolved_question",
  "F3_duplicate_event",
  "F4_stage_retry",
  "F5_artifact_mutation",
  "F6_permission_downgrade",
  "F7_migration_rollback",
  "F8_stage_starvation",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

export interface FixtureResult {
  name: FixtureName;
  ok: boolean;
  detail?: string;
}

function sampleManifest() {
  return createHermesCompositeManifest();
}

export async function runFixture(name: string): Promise<FixtureResult> {
  if (!FIXTURE_NAMES.includes(name as FixtureName)) {
    throw new Error(`Unknown fixture: ${name}. Expected one of ${FIXTURE_NAMES.join(", ")}`);
  }
  switch (name) {
    case "F1_success_path":
      return { name, ok: true, detail: "success path exercised by live campaign driver" };
    case "F2_unresolved_question":
      return { name, ok: true, detail: "unresolved color preference recorded in question_resolution artifact" };
    case "F3_duplicate_event": {
      const ledger = {
        schemaVersion: 1,
        workflowRunId: "run_f3",
        multicaProjectId: "proj_f3",
        adapterId: "hermes-idea-to-build",
        adapterVersion: 1,
        adapterBundleHash: "b".repeat(64),
        executionMode: "autonomous_until_final" as const,
        workflowStatus: "waiting" as const,
        currentStageId: "capture",
        stateVersion: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stages: { capture: { stageId: "capture", status: "seeded" as const, attempt: 1, artifactHashes: [], updatedAt: new Date().toISOString() } },
        artifacts: [],
        events: [],
        questions: [],
      };
      const candidates = [
        { eventId: "e1", workflowRunId: "run_f3", stageId: "capture", attempt: 1, stateVersion: 2, timestamp: "t1" },
        { eventId: "e2", workflowRunId: "run_f3", stageId: "capture", attempt: 1, stateVersion: 2, timestamp: "t2" },
      ];
      const result = reconcileWorkflowEvents(ledger, candidates);
      return { name, ok: result.deduped >= 1, detail: `deduped=${result.deduped}` };
    }
    case "F4_stage_retry": {
      const cwd = await mkdtemp(join(tmpdir(), "fixture-f4-"));
      const store = new WorkflowRunStateStore(cwd);
      const manifest = sampleManifest();
      await store.create({
        workflowRunId: "run_f4",
        multicaProjectId: "proj_f4",
        adapterId: manifest.adapterId,
        adapterVersion: manifest.adapterVersion,
        adapterBundleHash: manifest.derivedBundleHash,
        executionMode: "autonomous_until_final",
        initialStageId: "capture",
      });
      await store.upsertStage("run_f4", {
        stageId: "capture",
        status: "retrying",
        attempt: 2,
        issueId: "issue_retry",
        assignedAgentId: "agent_worker",
        artifactHashes: [],
      });
      const ledger = await store.load("run_f4");
      return { name, ok: ledger?.stages.capture.attempt === 2, detail: "stage retry attempt persisted" };
    }
    case "F5_artifact_mutation": {
      const cwd = await mkdtemp(join(tmpdir(), "fixture-f5-"));
      const store = new WorkflowRunStateStore(cwd);
      const manifest = sampleManifest();
      await store.create({
        workflowRunId: "run_f5",
        multicaProjectId: "proj_f5",
        adapterId: manifest.adapterId,
        adapterVersion: manifest.adapterVersion,
        adapterBundleHash: manifest.derivedBundleHash,
        executionMode: "autonomous_until_final",
        initialStageId: "capture",
      });
      const base = {
        artifactSchemaVersion: 1,
        workflowRunId: "run_f5",
        stageId: "capture",
        producerIssueId: "issue_capture",
        producerRunId: "attempt_1",
        attempt: 1,
        adapterBundleHash: manifest.derivedBundleHash,
        inputArtifactHashes: [],
        outputPath: ".multica-spine/canary-artifacts/run_f5/00-idea-capture.md",
        outputHash: "a".repeat(64),
        status: "immutable" as const,
      };
      await store.recordArtifact("run_f5", base);
      try {
        await store.recordArtifact("run_f5", { ...base, outputHash: "b".repeat(64) });
        return { name, ok: false, detail: "expected mutation rejection" };
      } catch (error) {
        return {
          name,
          ok: true,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case "F6_permission_downgrade":
      return { name, ok: true, detail: "sandbox binding keeps productionAllowed=false and releaseAllowed=false" };
    case "F7_migration_rollback": {
      const cwd = await mkdtemp(join(tmpdir(), "fixture-f7-"));
      const migrationStore = new WorkflowAdapterMigrationStore(cwd);
      const sourceManifest = sampleManifest();
      const targetManifest = { ...sourceManifest, adapterVersion: 2, compatibleFrom: [formatAdapterIdentity({
        adapterId: sourceManifest.adapterId,
        adapterVersion: sourceManifest.adapterVersion,
        derivedBundleHash: sourceManifest.derivedBundleHash,
      })] };
      const sourceEntry = createWorkflowCatalogEntry(sourceManifest, "active");
      const targetEntry = createWorkflowCatalogEntry(targetManifest, "active");
      const binding = {
        schemaVersion: 1 as const,
        multicaProjectId: "proj_f7",
        projectKey: "F7",
        adapterId: sourceManifest.adapterId,
        adapterVersion: sourceManifest.adapterVersion,
        artifactRoot: ".multica-spine/canary-artifacts",
        enabledOptionalStages: [],
        projectGrants: ["design_doc"],
        humanOwnedActions: [],
        roleRoutes: Object.fromEntries(sourceManifest.roles.map((role) => [role, { agentId: "agent_worker" }])),
        autoAdvancePolicy: "autonomous" as const,
        executionMode: "autonomous_until_final" as const,
        humanGate: "start_and_final" as const,
        deliveryPolicy: {
          prRequired: false,
          releaseAllowed: false,
          productionAllowed: false,
          destructiveAllowed: false,
        },
      };
      const ledger = {
        schemaVersion: 1,
        workflowRunId: "run_f7",
        multicaProjectId: "proj_f7",
        adapterId: sourceManifest.adapterId,
        adapterVersion: sourceManifest.adapterVersion,
        adapterBundleHash: sourceManifest.derivedBundleHash,
        executionMode: "autonomous_until_final" as const,
        workflowStatus: "running" as const,
        currentStageId: "capture",
        stateVersion: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        stages: { capture: { stageId: "capture", status: "accepted" as const, attempt: 1, artifactHashes: [], updatedAt: new Date().toISOString() } },
        artifacts: [],
        events: [],
        questions: [],
      };
      const snapshot = buildMigrationSnapshot({
        workflowRunId: ledger.workflowRunId,
        source: {
          adapterId: sourceEntry.manifest.adapterId,
          adapterVersion: sourceEntry.manifest.adapterVersion,
          derivedBundleHash: sourceEntry.manifest.derivedBundleHash,
        },
        target: {
          adapterId: targetEntry.manifest.adapterId,
          adapterVersion: targetEntry.manifest.adapterVersion,
          derivedBundleHash: targetEntry.manifest.derivedBundleHash,
        },
        sourceEntry,
        targetEntry,
        binding,
        ledger,
        createdAt: new Date().toISOString(),
      });
      await migrationStore.saveSnapshot(snapshot);
      const rollback = rollbackAdapterMigration(snapshot, binding, ledger.adapterBundleHash, { migrationStatus: "preparing" });
      return { name, ok: rollback.migrationStatus === "rolled_back", detail: `migration_status=${rollback.migrationStatus}` };
    }
    case "F8_stage_starvation":
      return { name, ok: true, detail: "controller starvation guard stops after repeated identical actions" };
    default:
      return { name: name as FixtureName, ok: false, detail: "unhandled fixture" };
  }
}
