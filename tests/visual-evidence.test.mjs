import assert from "node:assert/strict";
import test from "node:test";

const { assertVisualReviewEvidenceComplete, recordVisualEvidence } = await import("../lib/visual-evidence.ts");

const evidence = (stateId, screenshotHash) => ({
  stateId,
  device: "iPhone 17 Pro",
  os: "iOS 26.5",
  screenshotHash,
});

test("visual evidence retries are idempotent and changed screenshots get new identities", () => {
  const first = recordVisualEvidence([], evidence("initial_selection", "a".repeat(64)));
  const retry = recordVisualEvidence(first.records, evidence("initial_selection", "a".repeat(64)));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.records.length, 1);
  const changed = recordVisualEvidence(retry.records, evidence("initial_selection", "b".repeat(64)));
  assert.equal(changed.duplicate, false);
  assert.equal(changed.records.length, 2);
  assert.notEqual(changed.records[0].artifactIdentity, changed.records[1].artifactIdentity);
});

test("visual review requires every declared state", () => {
  assert.throws(
    () => assertVisualReviewEvidenceComplete({ evidence: [evidence("initial_selection", "a".repeat(64))] }, ["initial_selection", "result"]),
    /result/,
  );
  assert.doesNotThrow(() => assertVisualReviewEvidenceComplete({
    evidence: [evidence("initial_selection", "a".repeat(64)), evidence("result", "b".repeat(64))],
  }, ["initial_selection", "result"]));
});

