import { join } from "node:path";
import { sha256Hex } from "./hash.ts";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { LOCAL_IDEA_STAGE_IDS, type LocalIdeaStageId } from "./idea-local-lane.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export const REQUIRED_LOCAL_ARTIFACT_STAGES = LOCAL_IDEA_STAGE_IDS;

export interface IdeaLocalArtifactRecord {
  stageId: LocalIdeaStageId;
  outputPath: string;
  contentHash: string;
  provenance: {
    source: "local_lane";
    sessionId: string;
    recordedAt: string;
  };
}

export interface IdeaLocalArtifactRegistry {
  schemaVersion: 1;
  sessionId: string;
  workflowRunId: string;
  artifacts: IdeaLocalArtifactRecord[];
  artifactBundleHash: string;
  updatedAt: string;
}

export interface RecordLocalArtifactInput {
  sessionId: string;
  workflowRunId: string;
  stageId: LocalIdeaStageId;
  outputPath: string;
  content: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function computeBundleHash(artifacts: readonly IdeaLocalArtifactRecord[]): string {
  return sha256Hex(artifacts.map((artifact) => ({
    stageId: artifact.stageId,
    outputPath: artifact.outputPath,
    contentHash: artifact.contentHash,
  })));
}

export function createLocalArtifactRecord(input: RecordLocalArtifactInput): IdeaLocalArtifactRecord {
  return {
    stageId: input.stageId,
    outputPath: input.outputPath,
    contentHash: sha256Hex(input.content),
    provenance: {
      source: "local_lane",
      sessionId: input.sessionId,
      recordedAt: nowIso(),
    },
  };
}

export function validatePromotionReadyArtifacts(registry: IdeaLocalArtifactRegistry): void {
  const recorded = new Set(registry.artifacts.map((artifact) => artifact.stageId));
  for (const stageId of REQUIRED_LOCAL_ARTIFACT_STAGES) {
    if (!recorded.has(stageId)) {
      throw new Error(`Missing immutable local artifact for stage: ${stageId}`);
    }
  }
  const handoff = registry.artifacts.find((artifact) => artifact.stageId === "build_handoff");
  if (!handoff?.contentHash || handoff.contentHash.length !== 64) {
    throw new Error("build_handoff artifact must be hash-addressed before promotion_ready");
  }
  const expectedBundleHash = computeBundleHash(registry.artifacts);
  if (registry.artifactBundleHash !== expectedBundleHash) {
    throw new Error("Local artifact bundle hash mismatch");
  }
}

export function assertArtifactBundleUnchanged(
  registry: IdeaLocalArtifactRegistry,
  expectedBundleHash: string,
): void {
  const recomputedBundleHash = computeBundleHash(registry.artifacts);
  if (registry.artifactBundleHash !== recomputedBundleHash) {
    throw new Error("Local artifact bundle hash is inconsistent with recorded artifacts");
  }
  if (recomputedBundleHash !== expectedBundleHash) {
    throw new Error("Artifact bundle was altered after admission preflight");
  }
}

export class IdeaLocalArtifactStore {
  readonly path: string;
  readonly boundSessionId: string;

  constructor(cwd: string, sessionId: string) {
    this.boundSessionId = sessionId;
    this.path = join(cwd, SPINE_STATE_ROOT, "idea-artifacts", `${sessionId}.json`);
  }

  async load(): Promise<IdeaLocalArtifactRegistry | undefined> {
    return readJsonFile<IdeaLocalArtifactRegistry>(this.path);
  }

  async record(input: RecordLocalArtifactInput): Promise<IdeaLocalArtifactRegistry> {
    if (input.sessionId !== this.boundSessionId) {
      throw new Error(`Local artifact store is bound to session ${this.boundSessionId}`);
    }
    return withFileLock(this.path, async () => {
      const existing = await this.load();
      if (existing && (existing.sessionId !== input.sessionId || existing.workflowRunId !== input.workflowRunId)) {
        throw new Error("Local artifact registry identity mismatch");
      }
      const record = createLocalArtifactRecord(input);
      const artifacts = [...(existing?.artifacts ?? [])];
      const duplicateIndex = artifacts.findIndex((artifact) => artifact.stageId === input.stageId);
      if (duplicateIndex >= 0) {
        if (artifacts[duplicateIndex].contentHash !== record.contentHash) {
          throw new Error(`Immutable local artifact already recorded for stage: ${input.stageId}`);
        }
        return existing!;
      }
      artifacts.push(record);
      const registry: IdeaLocalArtifactRegistry = {
        schemaVersion: 1,
        sessionId: input.sessionId,
        workflowRunId: input.workflowRunId,
        artifacts,
        artifactBundleHash: computeBundleHash(artifacts),
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, registry);
      return registry;
    });
  }

  async finalizePromotionReady(input: {
    sessionId: string;
    workflowRunId: string;
    stageArtifacts: Array<{ stageId: LocalIdeaStageId; outputPath: string; content: string }>;
  }): Promise<IdeaLocalArtifactRegistry> {
    let registry: IdeaLocalArtifactRegistry | undefined;
    for (const artifact of input.stageArtifacts) {
      registry = await this.record({
        sessionId: input.sessionId,
        workflowRunId: input.workflowRunId,
        stageId: artifact.stageId,
        outputPath: artifact.outputPath,
        content: artifact.content,
      });
    }
    if (!registry) throw new Error("No local artifacts recorded");
    validatePromotionReadyArtifacts(registry);
    return registry;
  }
}

export interface ExternalMutationRecord {
  kind: string;
  target: string;
  at: string;
}

export class ExternalMutationSpy {
  readonly records: ExternalMutationRecord[] = [];

  record(kind: string, target: string): void {
    this.records.push({ kind, target, at: nowIso() });
  }

  assertZeroMutations(): void {
    if (this.records.length > 0) {
      throw new Error(`Expected zero external mutations, observed ${this.records.length}`);
    }
  }
}
