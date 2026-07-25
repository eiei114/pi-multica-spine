import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAutonomousVisualDecision,
  assertValidVisualBrief,
  assertValidVisualAssetPack,
  assertValidVisualReview,
  assertValidWorldPremise,
  hashVisualContent,
} from "../lib/visual-workflow-contract.ts";

const hash = (value) => hashVisualContent(value);

function premise(overrides = {}) {
  const base = {
    schemaVersion: 1,
    target: "ios_game",
    playerFantasy: "Read a relic and make one risky daily choice.",
    worldPromise: "Every day reveals one small mystery.",
    toneKeywords: ["mysterious", "tactile"],
    materialLanguage: ["weathered paper", "brass"],
    diegeticVocabulary: { hp: "vitality", gold: "relic shards", curse: "stain" },
    referenceBoundaries: ["Use card roguelike clarity; avoid generic dashboard styling."],
    provenance: [{ kind: "assumed", ref: "project-default:daily-relic" }],
    confidence: "medium",
    rationale: "The direction fits the title and keeps the daily choice legible.",
  };
  const { contentHash, ...rest } = { ...base, ...overrides };
  return { ...rest, contentHash: contentHash ?? hash(rest) };
}

test("World Premise requires autonomous provenance and hash", () => {
  assert.doesNotThrow(() => assertValidWorldPremise(premise()));
  assert.throws(() => assertValidWorldPremise(premise({ contentHash: "short" })), /Invalid World Premise/);
  assert.throws(() => assertValidWorldPremise(premise({ provenance: [] })), /Invalid World Premise/);
});

test("autonomous visual decisions continue with explicit assumed provenance", () => {
  assert.doesNotThrow(() => assertAutonomousVisualDecision({
    provenance: [{ kind: "assumed", ref: "project-default:daily-relic" }],
    confidence: "low",
    rationale: "No user taste preference was supplied; use the project default.",
  }));
  assert.throws(() => assertAutonomousVisualDecision({
    provenance: [{ kind: "inferred", ref: "design:1" }],
    confidence: "low",
    rationale: "A direction was selected.",
  }), /assumed or unresolved/);
});

test("Visual Brief and Visual Review carry the upstream hash lineage", () => {
  const world = premise();
  const worldHash = world.contentHash;
  const assetSpec = {
    assetId: "card-safe",
    semanticRole: "safe card icon",
    states: ["default", "selected"],
    sourceKind: "generated",
    format: "png",
    width: 128,
    height: 128,
    alpha: true,
    destination: "Assets.xcassets",
    provenance: [{ kind: "inferred", ref: "world:material-language" }],
    usageNote: "Generated for the Daily Relic MVP.",
  };
  const brief = {
    schemaVersion: 1,
    target: "ios_game",
    worldPremiseHash: worldHash,
    visualDirectionVersion: "v1",
    paletteRoles: { background: "deep brown", accent: "relic amber" },
    typographyRoles: { title: "display", body: "readable sans" },
    surfaceAndTextureRules: ["Use restrained paper grain."],
    screenStateMatrix: ["card-selection", "result"],
    motionBudget: ["selection pulse under 300ms"],
    soundHapticMapping: ["reward uses a short positive cue"],
    accessibilityRules: ["Never communicate state by color alone."],
    assets: [{ ...assetSpec, contentHash: hash(assetSpec) }],
    provenance: [{ kind: "inferred", ref: "world-premise" }],
    confidence: "medium",
    rationale: "The brief turns the world premise into implementable visual rules.",
  };
  brief.contentHash = hash(brief);
  assert.doesNotThrow(() => assertValidVisualBrief(brief));

  const review = {
    schemaVersion: 1,
    target: "ios_game",
    commitHash: "1234567",
    evidence: [{ stateId: "card-selection", device: "iPhone 17 Pro", os: "iOS 26.5", screenshotHash: "2".repeat(64) }],
    findings: [],
    accessibilityChecks: ["Dynamic Type", "Reduce Motion", "VoiceOver"],
    verdict: "pass",
    reviewerProvenance: [{ kind: "inferred", ref: "simulator:visual-review" }],
  };
  review.contentHash = hash(review);
  assert.doesNotThrow(() => assertValidVisualReview(review));

  const packPayload = {
    schemaVersion: 1,
    target: "ios_game",
    assetBriefHash: brief.contentHash,
    files: [{
      assetId: "card-safe",
      variantId: "card-safe-v1",
      path: "Assets.xcassets/card-safe.imageset/card-safe.png",
      contentHash: "6".repeat(64),
      byteLength: 128,
      format: "png",
    }],
    selections: [{
      assetId: "card-safe",
      selectedVariantId: "card-safe-v1",
      rejectedVariantIds: [],
      rationale: "Highest legibility at the target size.",
      confidence: "high",
    }],
    rejectedVariants: [],
    selectionRubric: ["legibility", "material fit", "state clarity"],
    idempotencyKeys: { "card-safe": "proj_daily-relic:card-safe:" + brief.contentHash },
  };
  const packManifestHash = hash(packPayload);
  const packContent = {
    ...packPayload,
    manifestHash: packManifestHash,
    provenance: [{ kind: "inferred", ref: "visual-brief:v1" }],
    confidence: "high",
    rationale: "The selected file is deterministic and ready for iOS integration.",
  };
  assert.doesNotThrow(() => assertValidVisualAssetPack({
    ...packContent,
    contentHash: hash(packContent),
  }));
});
