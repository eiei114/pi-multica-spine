#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const {
  IdeaLocalLaneStore,
  IdeaLocalArtifactStore,
  PortfolioFleetConfigStore,
  activatePortfolioIfReady,
  autoPromoteIdeaSession,
  createExplicitPortfolioPromotionFactory,
  loadExplicitPortfolioPromotionFactoryConfig,
} = await importSpineLibs(import.meta.url, [
  "idea-local-lane.ts",
  "idea-local-artifact.ts",
  "portfolio-fleet-enablement.ts",
  "portfolio-activation-entry.ts",
  "idea-auto-promotion.ts",
  "portfolio-promotion-factory.ts",
]);

function required(argv, flag) {
  const value = argv[argv.indexOf(flag) + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} is required`);
  return value;
}

export function parsePortfolioPromoteArgs(argv = process.argv.slice(2)) {
  return {
    canaryPath: required(argv, "--canary-path"),
    factoryConfigPath: required(argv, "--factory-config"),
    apply: argv.includes("--apply"),
  };
}

/**
 * Uses a named factory config and a durable fleet switch. No config fallback,
 * no implicit live client, and no write unless --apply is supplied.
 */
export async function runPortfolioPromotion(input, collaborators = {}) {
  const lane = await new IdeaLocalLaneStore(input.canaryPath).load();
  if (!lane) throw new Error("Portfolio promotion requires an existing local idea lane");
  const artifacts = await new IdeaLocalArtifactStore(input.canaryPath, lane.sessionId).load();
  if (!artifacts) throw new Error("Portfolio promotion requires the session-bound local artifact registry");
  const loadConfig = collaborators.loadConfig ?? loadExplicitPortfolioPromotionFactoryConfig;
  const createFactory = collaborators.createFactory ?? createExplicitPortfolioPromotionFactory;
  const promote = collaborators.promote ?? autoPromoteIdeaSession;
  const config = await loadConfig(input.factoryConfigPath);
  const deps = createFactory({ cwd: input.canaryPath, config });

  return activatePortfolioIfReady({
    cwd: input.canaryPath,
    lane,
    artifacts,
    fleetStore: collaborators.fleetStore ?? new PortfolioFleetConfigStore(input.canaryPath),
    deps,
    buildPromotionInput: () => ({
      sessionId: lane.sessionId,
      workflowRunId: lane.workflowRunId,
      projectTitle: config.projectTitle,
      projectDescription: config.projectDescription,
      artifactBundleHash: artifacts.artifactBundleHash,
      artifacts: artifacts.artifacts.map((artifact) => ({ stageId: artifact.stageId, outputPath: artifact.outputPath, outputHash: artifact.contentHash })),
      dryRun: !input.apply,
    }),
    promote,
  });
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  runPortfolioPromotion(parsePortfolioPromoteArgs()).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
