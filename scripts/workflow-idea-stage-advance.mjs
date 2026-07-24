#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const { IdeaLocalLaneStore, IdeaLocalArtifactStore, activatePortfolioIfReady } = await importSpineLibs(import.meta.url, ["idea-local-lane.ts", "idea-local-artifact.ts", "portfolio-activation-entry.ts"]);

export async function advanceIdeaLocalStage(canaryPath, { toPromotionReady = false, activationFactory } = {}) {
  const store = new IdeaLocalLaneStore(canaryPath);
  const lane = toPromotionReady ? await store.advanceToPromotionReady() : await store.advance();
  if (!activationFactory) return lane;
  const artifacts = await new IdeaLocalArtifactStore(canaryPath, lane.sessionId).load();
  if (!artifacts) throw new Error("Promotion-ready lane is missing its artifact registry");
  const factory = await activationFactory({ canaryPath, lane, artifacts });
  return {
    lane,
    activation: await activatePortfolioIfReady({ cwd: canaryPath, lane, artifacts, ...factory }),
  };
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  const index = process.argv.indexOf("--canary-path");
  const canaryPath = process.argv[index + 1];
  if (!canaryPath || canaryPath.startsWith("--")) {
    console.error("--canary-path is required");
    process.exitCode = 1;
  } else {
    advanceIdeaLocalStage(canaryPath, { toPromotionReady: process.argv.includes("--to-promotion-ready") }).then((state) => console.log(JSON.stringify(state, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
