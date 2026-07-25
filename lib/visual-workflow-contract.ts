import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { StringEnum } from "./schema.ts";
import { assertValid, validateSchema } from "./validation.ts";

const Sha256Hex = Type.String({ pattern: "^[a-f0-9]{64}$" });

export const VisualTargetSchema = StringEnum(["non_visual", "visual", "game", "ios_game"]);
export type VisualTarget = Static<typeof VisualTargetSchema>;

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
  sourceKind: StringEnum(["generated", "human_provided", "system_symbol", "vector"]),
  format: Type.String({ minLength: 1 }),
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  alpha: Type.Boolean(),
  destination: Type.String({ minLength: 1 }),
  provenance: Type.Array(VisualProvenanceSchema, { minItems: 1 }),
});
export type VisualAssetSpec = Static<typeof VisualAssetSpecSchema>;

export const VisualBriefSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  target: VisualTargetSchema,
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
  target: VisualTargetSchema,
  commitHash: Type.String({ minLength: 7 }),
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

export function assertValidWorldPremise(input: unknown): WorldPremise {
  return assertValid(validateSchema(WorldPremiseSchema, input), "Invalid World Premise");
}

export function assertValidVisualBrief(input: unknown): VisualBrief {
  return assertValid(validateSchema(VisualBriefSchema, input), "Invalid Visual Brief");
}

export function assertValidVisualReview(input: unknown): VisualReview {
  return assertValid(validateSchema(VisualReviewSchema, input), "Invalid Visual Review");
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
