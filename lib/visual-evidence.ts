import { sha256Hex } from "./hash.ts";
import type { VisualReview, VisualReviewEvidence } from "./visual-workflow-contract.ts";

export interface VisualEvidenceRecord {
  evidence: VisualReviewEvidence;
  artifactIdentity: string;
}

function evidenceIdentity(evidence: VisualReviewEvidence): string {
  return sha256Hex({
    stateId: evidence.stateId,
    device: evidence.device,
    os: evidence.os,
    screenshotHash: evidence.screenshotHash,
  });
}

/**
 * Successful evidence uploads are immutable. An identical retry returns the
 * existing record; a changed screenshot becomes a new evidence identity.
 */
export function recordVisualEvidence(
  existing: readonly VisualEvidenceRecord[],
  evidence: VisualReviewEvidence,
): { records: VisualEvidenceRecord[]; duplicate: boolean } {
  const identity = evidenceIdentity(evidence);
  if (existing.some((record) => record.artifactIdentity === identity)) {
    return { records: [...existing], duplicate: true };
  }
  return {
    records: [...existing, { evidence, artifactIdentity: identity }],
    duplicate: false,
  };
}

export function assertVisualReviewEvidenceComplete(
  review: Pick<VisualReview, "evidence">,
  requiredStateIds: readonly string[],
): void {
  const stateIds = new Set(review.evidence.map((item) => item.stateId));
  const missing = requiredStateIds.filter((stateId) => !stateIds.has(stateId));
  if (missing.length) throw new Error(`Visual review evidence missing states: ${missing.join(",")}`);
  const identities = new Set(review.evidence.map(evidenceIdentity));
  if (identities.size !== review.evidence.length) {
    throw new Error("Visual review evidence contains duplicate screenshot identities");
  }
}

