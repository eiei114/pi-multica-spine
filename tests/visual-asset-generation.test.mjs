import assert from "node:assert/strict";
import test from "node:test";

const {
  buildAssetIdempotencyKey,
  createVisualAssetPack,
  evaluateAssetGenerationCapability,
  selectAssetVariant,
} = await import("../lib/visual-asset-generation.ts");

test("asset generation fails closed when approved capability is absent", () => {
  assert.deepEqual(evaluateAssetGenerationCapability(undefined), {
    status: "blocked",
    reason: "asset_generation_capability_unavailable",
    capabilityId: "asset_generation",
  });
  assert.throws(
    () => buildAssetIdempotencyKey("project", "card-safe", "short"),
    /brief hash/,
  );
});

test("asset variant selection is deterministic and idempotent", () => {
  const briefHash = "a".repeat(64);
  const selection = selectAssetVariant({
    assetId: "card-safe",
    confidence: "high",
    variants: [
      { variantId: "v2", score: 9, rationale: "More legible at 128px." },
      { variantId: "v1", score: 9, rationale: "Same score, loses stable tie-break." },
    ],
  });
  assert.equal(selection.selectedVariantId, "v1");
  assert.equal(buildAssetIdempotencyKey("project", "card-safe", briefHash), `project:card-safe:${briefHash}`);
  const pack = createVisualAssetPack({
    target: "ios_game",
    assetBriefHash: briefHash,
    files: [{
      assetId: "card-safe",
      variantId: "v1",
      path: "Assets.xcassets/card-safe.imageset/card-safe.png",
      contentHash: "b".repeat(64),
      byteLength: 128,
      format: "png",
    }],
    selections: [selection],
    selectionRubric: ["legibility"],
    projectId: "project",
    provenance: [{ kind: "inferred", ref: "visual-brief:v1" }],
    confidence: "high",
    rationale: "Stable selection for the MVP.",
  });
  assert.equal(pack.idempotencyKeys["card-safe"], `project:card-safe:${briefHash}`);
  assert.equal(pack.manifestHash.length, 64);
});

