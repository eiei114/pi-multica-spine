#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { importSpineLibs } from "./spine-lib-import.mjs";

const { IdeaLocalLaneStore, resolveImplementationProject, buildImplementationSpineHandoff, runMultica } = await importSpineLibs(import.meta.url, [
  "idea-local-lane.ts",
  "idea-project-promotion.ts",
  "multica-cli.ts",
]);

function required(argv, flag) {
  const value = argv[argv.indexOf(flag) + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} is required`);
  return value;
}

export function parseIdeaBuildHandoffArgs(argv = process.argv.slice(2)) {
  return {
    canaryPath: required(argv, "--canary-path"),
    projectTitle: required(argv, "--project-title"),
    apply: argv.includes("--apply"),
  };
}

export async function runIdeaBuildHandoff({ canaryPath, projectTitle, apply = false, runner = runMultica }) {
  const store = new IdeaLocalLaneStore(canaryPath);
  const lane = await store.load();
  if (!lane || lane.status !== "promotion_ready" || lane.currentStageId !== "build_handoff") {
    throw new Error("Build handoff requires a promotion-ready local idea lane");
  }
  const spineHandoff = buildImplementationSpineHandoff({
    project: { id: "pending", title: projectTitle, status: "planned" },
    workflowRunId: lane.workflowRunId,
  });
  if (!apply) return { mode: "dry-run", lane, spineHandoff };
  const client = {
    async list() { return JSON.parse((await runner(["project", "list", "--output", "json"])).stdout); },
    async create(input) {
      return JSON.parse((await runner(["project", "create", "--title", input.title, "--description", input.description, "--status", "planned", "--output", "json"])).stdout);
    },
  };
  const resolved = await resolveImplementationProject({ projectTitle, projectDescription: `Implementation lane for ${lane.workflowRunId}`, client });
  const promoted = await store.bindImplementationProject(resolved.project);
  return { mode: "applied", project: resolved.project, reused: resolved.reused, lane: promoted, spineHandoff: buildImplementationSpineHandoff({ project: resolved.project, workflowRunId: lane.workflowRunId }) };
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(process.argv[1]).href : "")) {
  runIdeaBuildHandoff(parseIdeaBuildHandoffArgs()).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
