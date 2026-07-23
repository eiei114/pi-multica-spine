import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNpmPublishFailure,
  shouldTreatNpmPublishFailureAsSuccess,
} from "../lib/npm-publish-classify.ts";

const BENIGN_STDERR = `npm error code E403
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/pi-multica-spine - You cannot publish over the previously published versions: 0.6.0.`;

test("classifies matching shasum E403 as benign already published", () => {
  const input = {
    stderr: BENIGN_STDERR,
    localShasum: "abc123",
    publishedShasum: "abc123",
  };
  assert.equal(classifyNpmPublishFailure(input), "benign_already_published");
  assert.equal(shouldTreatNpmPublishFailureAsSuccess(input), true);
});

test("classifies mismatched shasum as forbidden", () => {
  const input = {
    stderr: BENIGN_STDERR,
    localShasum: "abc123",
    publishedShasum: "def456",
  };
  assert.equal(classifyNpmPublishFailure(input), "forbidden");
  assert.equal(shouldTreatNpmPublishFailureAsSuccess(input), false);
});

test("classifies auth errors as auth_failure", () => {
  const input = { stderr: "npm error code E401\nnpm error ENEEDAUTH" };
  assert.equal(classifyNpmPublishFailure(input), "auth_failure");
});

test("classifies missing package as not_found", () => {
  const input = { stderr: "npm error code E404\nnpm error 404 Not Found" };
  assert.equal(classifyNpmPublishFailure(input), "not_found");
});
