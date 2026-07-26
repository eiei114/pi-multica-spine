import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { StringEnum } from "./schema.ts";
import { assertValid, validateSchema } from "./validation.ts";

const Sha256Hex = Type.String({ pattern: "^[a-f0-9]{64}$" });

export const VisualTargetSchema = StringEnum(["non_visual", "visual", "game", "ios_game"]);
export type VisualTarget = Static<typeof VisualTargetSchema>;

export const VisualOnlyTargetSchema = StringEnum(["visual", "game", "ios_game"]);
export type VisualOnlyTarget = Static<typeof VisualOnlyTargetSchema>;

export const VisualAssetSourceKindSchema = StringEnum(["generated", "human_provided", "system_symbol", "vector"]);
export type VisualAssetSourceKind = Static<typeof VisualAssetSourceKindSchema>;

export const VisualProvenanceKindSchema = StringEnum([
  "user_statement",
  "external_source",
  "declared_default",
  "inferred",
  "assumed",
  "unresolved",
]);
export type VisualProvenanceKind = Static<typeof VisualProvenanceKindSchema>;

export const VisualConfidenceSchema = StringEnum(["high", "medium", "low"]);
export type VisualConfidence = Static<typeof VisualConfidenceSchema>;

export const VisualProvenanceSchema = Type.Object({
  kind: VisualProvenanceKindSchema,
  ref: Type.String({ minLength: 1 }),
});
export type VisualProvenance = Static<typeof VisualProvenanceSchema>;

export const WorldPremiseSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  target: VisualTargetSchema,
  playerFantasy: Type.String({ minLength: 1 }),
  worldPromise: Type.String({ minLength: 1 }),
  toneKeywords: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  materialLanguage: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  diegeticVocabulary: Type.Record(Type.String(), Type.String({ minLength: 1 })),
  referenceBoundaries: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  provenance: Type.Array(VisualProvenanceSchema, { minItems: 1 }),
  confidence: VisualConfidenceSchema,
  rationale: Type.String({ minLength: 1 }),
  contentHash: Sha256Hex,
});
export type WorldPremise = Static<typeof WorldPremiseSchema>;

export const VisualAssetSpecSchema = Type.Object({
  assetId: Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9_-]*$" }),
  semanticRole: Type.String({ minLength: 1 }),
  states: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  sourceKind: VisualAssetSourceKindSchema,
  format: Type.String({ minLength: 1 }),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  alpha: Type.Boolean(),
  destination: Type.String({ minLength: 1 }),
  provenance: Type.Array(VisualProvenanceSchema, { minItems: 1 }),
  contentHash: Sha256Hex,
  usageNote: Type.String({ minLength: 1 }),
});
export type VisualAssetSpec = Static<typeof VisualAssetSpecSchema>;

export const VisualAssetFileSchema = Type.Object({
  assetId: Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9_-]*$" }),
  variantId: Type.String({ minLength: 1 }),
  path: Type.String({ minLength: 1 }),
  contentHash: Sha256Hex,
  byteLength: Type.Integer({ minimum: 1 }),
  format: Type.String({ minLength: 1 }),
});
export type VisualAssetFile = Static<typeof VisualAssetFileSchema>;

export const VisualAssetSelectionSchema = Type.Object({
  assetId: Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9_-]*$" }),
  selectedVariantId: Type.String({ minLength: 1 }),
  rejectedVariantIds: Type.Array(Type.String({ minLength: 1 })),
  rationale: Type.String({ minLength: 1 }),
  confidence: VisualConfidenceSchema,
});
export type VisualAssetSelection = Static<typeof VisualAssetSelectionSchema>;

export const VisualAssetPackSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  target: VisualOnlyTargetSchema,
  assetBriefHash: Sha256Hex,
  manifestHash: Sha256Hex,
  files: Type.Array(VisualAssetFileSchema, { minItems: 1 }),
  selections: Type.Array(VisualAssetSelectionSchema, { minItems: 1 }),
  rejectedVariants: Type.Array(Type.String({ minLength: 1 })),
  selectionRubric: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  idempotencyKeys: Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 })),
  provenance: Type.Array(VisualProvenanceSchema, { minItems: 1 }),
  confidence: VisualConfidenceSchema,
  rationale: Type.String({ minLength: 1 }),
  contentHash: Sha256Hex,
});
export type VisualAssetPack = Static<typeof VisualAssetPackSchema>;

export const VisualAssetManifestSchema = VisualAssetPackSchema;
export type VisualAssetManifest = VisualAssetPack;

export const VisualBriefSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  target: VisualOnlyTargetSchema,
  worldPremiseHash: Sha256Hex,
  visualDirectionVersion: Type.String({ minLength: 1 }),
  paletteRoles: Type.Record(Type.String(), Type.String({ minLength: 1 })),
  typographyRoles: Type.Record(Type.String(), Type.String({ minLength: 1 })),
  surfaceAndTextureRules: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  screenStateMatrix: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  motionBudget: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  soundHapticMapping: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  accessibilityRules: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  assets: Type.Array(VisualAssetSpecSchema, { minItems: 1 }),
  provenance: Type.Array(VisualProvenanceSchema, { minItems: 1 }),
  confidence: VisualConfidenceSchema,
  rationale: Type.String({ minLength: 1 }),
  contentHash: Sha256Hex,
});
export type VisualBrief = Static<typeof VisualBriefSchema>;

export const VisualReviewEvidenceSchema = Type.Object({
  stateId: Type.String({ minLength: 1 }),
  device: Type.String({ minLength: 1 }),
  os: Type.String({ minLength: 1 }),
  screenshotHash: Sha256Hex,
});
export type VisualReviewEvidence = Static<typeof VisualReviewEvidenceSchema>;

export const VisualReviewSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  target: VisualOnlyTargetSchema,
  commitHash: Type.String({ minLength: 7 }),
  previewConfiguration: Type.Optional(Type.String({ minLength: 1 })),
  evidence: Type.Array(VisualReviewEvidenceSchema, { minItems: 1 }),
  findings: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    severity: StringEnum(["P0", "P1", "P2"]),
    summary: Type.String({ minLength: 1 }),
  })),
  accessibilityChecks: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  verdict: StringEnum(["pass", "fail"]),
  reviewerProvenance: Type.Array(VisualProvenanceSchema, { minItems: 1 }),
  contentHash: Sha256Hex,
});
export type VisualReview = Static<typeof VisualReviewSchema>;

export function hashVisualContent(input: unknown): string {
  return sha256Hex(input);
}

function hashWithoutContentHash(input: Record<string, unknown>): string {
  const { contentHash: _contentHash, ...payload } = input;
  return hashVisualContent(payload);
}

function assertContentHash(input: Record<string, unknown>, label: string): void {
  if (input.contentHash !== hashWithoutContentHash(input)) {
    throw new Error(`${label} content hash mismatch`);
  }
}

export function assertValidWorldPremise(input: unknown): WorldPremise {
  const value = assertValid(validateSchema(WorldPremiseSchema, input), "Invalid World Premise");
  assertContentHash(value, "World Premise");
  return value;
}

export function assertValidVisualBrief(input: unknown): VisualBrief {
  const value = assertValid(validateSchema(VisualBriefSchema, input), "Invalid Visual Brief");
  assertContentHash(value, "Visual Brief");
  for (const asset of value.assets) assertContentHash(asset, `Visual Asset Spec ${asset.assetId}`);
  return value;
}

export function assertValidVisualReview(input: unknown): VisualReview {
  const value = assertValid(validateSchema(VisualReviewSchema, input), "Invalid Visual Review");
  assertContentHash(value, "Visual Review");
  return value;
}

export function assertValidVisualAssetPack(input: unknown): VisualAssetPack {
  const value = assertValid(validateSchema(VisualAssetPackSchema, input), "Invalid Visual Asset Pack");
  const expectedManifestHash = sha256Hex({
    schemaVersion: value.schemaVersion,
    target: value.target,
    assetBriefHash: value.assetBriefHash,
    files: value.files,
    selections: value.selections,
    rejectedVariants: value.rejectedVariants,
    selectionRubric: value.selectionRubric,
    idempotencyKeys: value.idempotencyKeys,
  });
  if (value.manifestHash !== expectedManifestHash) {
    throw new Error("Visual Asset Pack manifest hash mismatch");
  }
  assertContentHash(value, "Visual Asset Pack");
  return value;
}

export function assertValidVisualAssetManifest(input: unknown): VisualAssetManifest {
  return assertValidVisualAssetPack(input);
}

export function assertAutonomousVisualDecision(input: {
  provenance: readonly VisualProvenance[];
  confidence: VisualConfidence;
  rationale: string;
}): void {
  if (!input.rationale.trim()) throw new Error("Autonomous visual decisions require rationale");
  if (input.provenance.length === 0) throw new Error("Autonomous visual decisions require provenance");
  if (input.confidence === "low" && !input.provenance.some((item) => item.kind === "assumed" || item.kind === "unresolved")) {
    throw new Error("Low-confidence visual decisions require assumed or unresolved provenance");
  }
}
