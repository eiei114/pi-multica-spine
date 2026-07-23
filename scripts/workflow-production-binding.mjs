#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { createHermesCompositeManifest } from "../lib/hermes-adapter.ts";
import { ProjectWorkflowBindingStore } from "../lib/project-workflow-binding-store.ts";
import { WorkflowCatalogStore } from "../lib/workflow-catalog-store.ts";
import {
  buildProductionBindingPlan,
  buildProductionWorkflowBinding,
  PRODUCTION_PROJECT_ID,
  PRODUCTION_REPO_PATH,
  PRODUCTION_DAEMON_ID,
} from "../lib/workflow-production-binding.ts";
import { buildWorkflowLiveCli } from "../lib/workflow-live-cli.ts";
import {
  createAutopilotClient,
  createIssueClient,
  createMetadataClient,
  createProjectClient,
  runMultica,
} from "../lib/multica-cli.ts";

export function parseProductionBindingArgs(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      "repo-path": { type: "string", default: PRODUCTION_REPO_PATH },
      "project-id": { type: "string", default: PRODUCTION_PROJECT_ID },
    },
    allowPositionals: false,
  });
  return {
    dryRun: values["dry-run"] ?? false,
    apply: values.apply ?? false,
    repoPath: values["repo-path"] ?? PRODUCTION_REPO_PATH,
    projectId: values["project-id"] ?? PRODUCTION_PROJECT_ID,
  };
}

function multicaJson(args) {
  const stdout = execFileSync("multica", args, { encoding: "utf8" });
  return stdout.trim() ? JSON.parse(stdout) : {};
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function applyProductionWorkflowBinding(config) {
  if (config.projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(`Refusing production binding for unexpected project id: ${config.projectId}`);
  }
  if (!(await pathExists(config.repoPath))) {
    throw new Error(`Production repo path not found: ${config.repoPath}`);
  }
  const manifest = createHermesCompositeManifest();
  const binding = buildProductionWorkflowBinding(config.projectId);
  const catalogStore = new WorkflowCatalogStore(config.repoPath);
  let entry = await catalogStore.get(manifest.adapterId, manifest.adapterVersion);
  if (!entry) {
    entry = await catalogStore.upsert(manifest, "quarantined");
    for (const status of ["audited", "active"]) {
      entry = await catalogStore.transition(manifest.adapterId, manifest.adapterVersion, status);
    }
  } else if (entry.status !== "active") {
    for (const status of entry.status === "quarantined" ? ["audited", "active"] : ["active"]) {
      try {
        entry = await catalogStore.transition(manifest.adapterId, manifest.adapterVersion, status);
      } catch {
        break;
      }
    }
  }
  const liveCli = buildWorkflowLiveCli(
    createIssueClient(runMultica),
    createMetadataClient(runMultica),
    createProjectClient(runMultica),
    createAutopilotClient(runMultica),
  );
  await new ProjectWorkflowBindingStore(config.repoPath, { liveCli }).save(binding);
  const resources = multicaJson(["project", "resource", "list", config.projectId, "--output", "json"]);
  const hasRepo = Array.isArray(resources) && resources.some((item) =>
    item.resource_type === "local_directory" &&
    item.resource_ref?.local_path?.replace(/\\/g, "/") === config.repoPath.replace(/\\/g, "/"),
  );
  let resource;
  if (!hasRepo) {
    resource = multicaJson([
      "project", "resource", "add", config.projectId,
      "--type", "local_directory",
      "--local-path", config.repoPath,
      "--daemon-id", PRODUCTION_DAEMON_ID,
      "--label", "pi-multica-spine-production-tree",
      "--output", "json",
    ]);
  }
  const project = multicaJson(["project", "get", config.projectId, "--output", "json"]);
  return { binding, catalogStatus: entry.status, project, resource, resources };
}

async function main() {
  const config = parseProductionBindingArgs();
  const plan = { ...buildProductionBindingPlan(), repoPath: config.repoPath };
  if (config.dryRun || !config.apply) {
    console.log(JSON.stringify({ mode: "dry-run", plan }, null, 2));
    return;
  }
  const result = await applyProductionWorkflowBinding(config);
  console.log(JSON.stringify({ mode: "apply", plan, result }, null, 2));
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
