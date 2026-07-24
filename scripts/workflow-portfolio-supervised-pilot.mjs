#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const {
  IdeaLocalLaneStore,
  IdeaLocalArtifactStore,
  autoPromoteIdeaSession,
  createExplicitPortfolioPromotionFactory,
  loadExplicitPortfolioPromotionFactoryConfig,
  sha256Hex,
} = await importSpineLibs(import.meta.url, [
  "idea-local-lane.ts",
  "idea-local-artifact.ts",
  "idea-auto-promotion.ts",
  "portfolio-promotion-factory.ts",
  "hash.ts",
]);

function required(argv, flag) {
  const value = argv[argv.indexOf(flag) + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} is required`);
  return value;
}

export function parseSupervisedPilotArgs(argv = process.argv.slice(2)) {
  return {
    canaryPath: required(argv, "--canary-path"),
    factoryConfigPath: required(argv, "--factory-config"),
    evidenceOutput: required(argv, "--evidence-output"),
    apply: argv.includes("--apply"),
  };
}

async function writePilotEvidence(path, evidence, write = async (target, content) => {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}) {
  const content = `${JSON.stringify(evidence, null, 2)}\n`;
  await write(path, content);
  return { path, hash: sha256Hex(content) };
}

/**
 * One operator-authorized pilot bypass before fleet enablement. It is bounded to
 * the config's exact planned Project and records evidence only after success.
 */
export async function runPortfolioSupervisedPilot(input, collaborators = {}) {
  if (!input.apply) throw new Error("Supervised pilot requires explicit --apply");
  const loadConfig = collaborators.loadConfig ?? loadExplicitPortfolioPromotionFactoryConfig;
  const createFactory = collaborators.createFactory ?? createExplicitPortfolioPromotionFactory;
  const promote = collaborators.promote ?? autoPromoteIdeaSession;
  const config = await loadConfig(input.factoryConfigPath);
  if (!config.supervisedPilot) throw new Error("Supervised pilot requires supervisedPilot project id/title in factory config");
  if (config.projectTitle !== config.supervisedPilot.projectTitle) {
    throw new Error("Supervised pilot project title must exactly match factory projectTitle");
  }
  const lane = await new IdeaLocalLaneStore(input.canaryPath).load();
  if (!lane || lane.status !== "promotion_ready" || lane.currentStageId !== "build_handoff") {
    throw new Error("Supervised pilot requires a promotion-ready build_handoff lane");
  }
  const artifacts = await new IdeaLocalArtifactStore(input.canaryPath, lane.sessionId).load();
  if (!artifacts) throw new Error("Supervised pilot requires the session-bound artifact registry");
  const deps = createFactory({ cwd: input.canaryPath, config });
  const matches = (await deps.projects.list()).filter((project) => (
    project.id === config.supervisedPilot.projectId
    && project.title === config.supervisedPilot.projectTitle
    && project.status === "planned"
  ));
  if (matches.length !== 1) throw new Error("Supervised pilot requires exactly one configured planned Project");
  const promotion = await promote({
    sessionId: lane.sessionId,
    workflowRunId: lane.workflowRunId,
    projectTitle: config.projectTitle,
    projectDescription: config.projectDescription,
    artifactBundleHash: artifacts.artifactBundleHash,
    artifacts: artifacts.artifacts.map((artifact) => ({ stageId: artifact.stageId, outputPath: artifact.outputPath, outputHash: artifact.contentHash })),
  }, deps);
  if (!["promoted", "reused"].includes(promotion.mode)) {
    throw new Error(`Supervised pilot did not complete promotion: ${promotion.mode}`);
  }
  const evidence = {
    schemaVersion: 1,
    kind: "portfolio_supervised_pilot",
    project: config.supervisedPilot,
    sessionId: lane.sessionId,
    workflowRunId: lane.workflowRunId,
    artifactBundleHash: artifacts.artifactBundleHash,
    promotionMode: promotion.mode,
    recordedAt: new Date().toISOString(),
  };
  const artifact = await writePilotEvidence(input.evidenceOutput, evidence, collaborators.writeEvidence);
  return { mode: "supervised_pilot", promotion, evidence: artifact };
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  runPortfolioSupervisedPilot(parseSupervisedPilotArgs()).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
