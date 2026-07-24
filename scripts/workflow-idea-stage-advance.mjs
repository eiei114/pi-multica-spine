#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const { IdeaLocalLaneStore } = await importSpineLibs(import.meta.url, ["idea-local-lane.ts"]);

export async function advanceIdeaLocalStage(canaryPath) {
  return new IdeaLocalLaneStore(canaryPath).advance();
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  const index = process.argv.indexOf("--canary-path");
  const canaryPath = process.argv[index + 1];
  if (!canaryPath || canaryPath.startsWith("--")) {
    console.error("--canary-path is required");
    process.exitCode = 1;
  } else {
    advanceIdeaLocalStage(canaryPath).then((state) => console.log(JSON.stringify(state, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
