import { sha256Hex } from "./hash.ts";
import {
  assertValidVisualAssetPack,
  type VisualAssetFile,
  type VisualAssetPack,
  type VisualAssetSelection,
} from "./visual-workflow-contract.ts";

export interface AssetGenerationCapability {
  capabilityId: string;
  provider: string;
  approved: boolean;
}

export interface AssetVariantScore {
  variantId: string;
  score: number;
  rationale: string;
}

export interface AssetGenerationBlocked {
  status: "blocked";
  reason: "asset_generation_capability_unavailable";
  capabilityId: "asset_generation";
}

export interface AssetGenerationReady {
  status: "ready";
  capability: AssetGenerationCapability;
}

export function assertAssetGenerationCapability(
  capability: AssetGenerationCapability | undefined,
): AssetGenerationReady {
  if (!capability || capability.capabilityId !== "asset_generation" || !capability.approved) {
    throw new Error("asset_generation_capability_unavailable");
  }
  return { status: "ready", capability };
}

export function evaluateAssetGenerationCapability(
  capability: AssetGenerationCapability | undefined,
): AssetGenerationReady | AssetGenerationBlocked {
  if (!capability || capability.capabilityId !== "asset_generation" || !capability.approved) {
    return {
      status: "blocked",
      reason: "asset_generation_capability_unavailable",
      capabilityId: "asset_generation",
    };
  }
  return { status: "ready", capability };
}

export function buildAssetIdempotencyKey(projectId: string, assetId: string, assetBriefHash: string): string {
  if (!projectId.trim() || !assetId.trim() || !/^[a-f0-9]{64}$/.test(assetBriefHash)) {
    throw new Error("Asset idempotency key requires project, asset, and brief hash");
  }
  return `${projectId}:${assetId}:${assetBriefHash}`;
}

export function selectAssetVariant(input: {
  assetId: string;
  variants: readonly AssetVariantScore[];
  confidence: VisualAssetSelection["confidence"];
}): VisualAssetSelection {
  if (!input.variants.length) throw new Error(`No asset variants available: ${input.assetId}`);
  if (!input.variants.every((variant) => Number.isFinite(variant.score))) {
    throw new Error(`Asset variant scores must be finite: ${input.assetId}`);
  }
  const sorted = [...input.variants].sort((left, right) => right.score - left.score || left.variantId.localeCompare(right.variantId));
  const winner = sorted[0];
  return {
    assetId: input.assetId,
    selectedVariantId: winner.variantId,
    rejectedVariantIds: sorted.slice(1).map((variant) => variant.variantId),
    rationale: winner.rationale,
    confidence: input.confidence,
  };
}

export function createVisualAssetPack(input: {
  target: VisualAssetPack["target"];
  assetBriefHash: string;
  files: readonly VisualAssetFile[];
  selections: readonly VisualAssetSelection[];
  selectionRubric: readonly string[];
  projectId: string;
  provenance: VisualAssetPack["provenance"];
  confidence: VisualAssetPack["confidence"];
  rationale: string;
  rejectedVariants?: readonly string[];
}): VisualAssetPack {
  const idempotencyKeys = Object.fromEntries(input.selections.map((selection) => [
    selection.assetId,
    buildAssetIdempotencyKey(input.projectId, selection.assetId, input.assetBriefHash),
  ]));
  const manifestPayload = {
    schemaVersion: 1,
    target: input.target,
    assetBriefHash: input.assetBriefHash,
    files: input.files,
    selections: input.selections,
    rejectedVariants: input.rejectedVariants ?? [],
    selectionRubric: input.selectionRubric,
    idempotencyKeys,
  };
  const manifestHash = sha256Hex(manifestPayload);
  const contentPayload = {
    ...manifestPayload,
    manifestHash,
    provenance: input.provenance,
    confidence: input.confidence,
    rationale: input.rationale,
  };
  return assertValidVisualAssetPack({
    ...contentPayload,
    contentHash: sha256Hex(contentPayload),
  });
}
