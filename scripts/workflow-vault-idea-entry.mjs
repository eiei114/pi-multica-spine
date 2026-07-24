#!/usr/bin/env node
/**
 * Vault-native Idea-to-Build entry (R-MNT-44, Release A #59).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveIdeaEntryConfig } from "../lib/idea-entry-config.ts";
import { buildVaultIdeaNoteMarkdown, validateVaultIdeaNoteForWrite } from "../lib/vault-idea-note.ts";
import { slugifyRoughIdea } from "./workflow-sandbox-canary.mjs";
import {
  loadRoughIdeaFromArgs,
  parseWorkflowIdeaEntryArgs,
  runWorkflowIdeaEntry,
  validateRoughIdea,
} from "./workflow-idea-entry.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const VAULT_IDEA_RELATIVE_DIR = "4_Project/Multica-Agent-Strategy/Ideas";

export function parseWorkflowVaultIdeaEntryArgs(argv = process.argv.slice(2)) {
  const ideaArgs = parseWorkflowIdeaEntryArgs(argv);
  const vaultRootArg = argv.find((arg, index) => argv[index - 1] === "--vault-root");
  const vaultIdeaFileArg = argv.find((arg, index) => argv[index - 1] === "--vault-idea-file");
  return {
    ...ideaArgs,
    vaultRoot: vaultRootArg,
    vaultIdeaFile: vaultIdeaFileArg,
  };
}

export function buildVaultIdeaNotePath(vaultRoot, roughIdea, nowInput = new Date(), relativeDir = VAULT_IDEA_RELATIVE_DIR) {
  const now = nowInput instanceof Date ? nowInput : nowInput?.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const slug = slugifyRoughIdea(roughIdea, 40);
  return join(vaultRoot, relativeDir, `${date}-${slug}.md`);
}

export { buildVaultIdeaNoteMarkdown };

export async function writeVaultIdeaNote(vaultRoot, roughIdea, options = {}) {
  const relativeDir = options.vaultIdeaRelativeDir ?? VAULT_IDEA_RELATIVE_DIR;
  const notePath = options.vaultIdeaFile ?? buildVaultIdeaNotePath(vaultRoot, roughIdea, options.now, relativeDir);
  await mkdir(dirname(notePath), { recursive: true });
  const body = buildVaultIdeaNoteMarkdown(roughIdea, {
    now: options.now instanceof Date ? options.now : options.now?.now,
    status: options.status,
    parentIdentifier: options.parentIdentifier,
    workflowRunId: options.workflowRunId,
    canaryPath: options.canaryPath,
  });
  const validation = validateVaultIdeaNoteForWrite(body);
  if (!validation.ok) throw new Error(validation.error);
  await writeFile(notePath, body, "utf8");
  return notePath;
}

export async function runWorkflowVaultIdeaEntry(options = {}) {
  const roughIdea =
    options.roughIdea ??
    (options.vaultIdeaFile ? (await readFile(options.vaultIdeaFile, "utf8")).trim() : undefined) ??
    (await loadRoughIdeaFromArgs(options));
  const validation = validateRoughIdea(roughIdea);
  if (!validation.ok) {
    return { ok: false, mode: "validation", error: validation.error };
  }
  const idea = validation.roughIdea;

  let config;
  try {
    config = await resolveIdeaEntryConfig({
      flagVaultRoot: options.vaultRoot,
      flagSessionsRoot: options.sessionsRoot,
      cwd: options.cwd,
      projectConfigPath: options.projectConfigPath,
    });
  } catch (error) {
    return { ok: false, mode: "validation", error: error instanceof Error ? error.message : String(error) };
  }
  if (!config.vaultRoot) {
    return { ok: false, mode: "validation", error: "Vault root required. Pass --vault-root or set PI_VAULT_ROOT." };
  }
  const vaultRoot = config.vaultRoot;

  const draftNote = await writeVaultIdeaNote(vaultRoot, idea, {
    now: options.now,
    vaultIdeaFile: options.vaultIdeaFile,
    vaultIdeaRelativeDir: config.vaultIdeaRelativeDir,
    status: options.execute ? "starting" : "planned",
  });

  const entry = await runWorkflowIdeaEntry({
    execute: options.execute ?? false,
    canaryPath: options.canaryPath,
    reuseDefaultCanary: options.reuseDefaultCanary ?? false,
    roughIdea: idea,
    maxStageCycles: options.maxStageCycles,
    sessionSuffix: options.sessionSuffix,
    invocationToken: options.invocationToken,
    newSession: options.newSession,
    vaultRoot: config.vaultRoot,
    sessionsRoot: config.sessionsRoot,
    cwd: options.cwd,
    now: options.now,
  });

  if (!entry.ok) {
    return {
      ...entry,
      vaultRoot,
      vaultIdeaNote: draftNote,
      skillCommand: "/skill:idea-to-build",
    };
  }

  const vaultIdeaNote = await writeVaultIdeaNote(vaultRoot, idea, {
    now: options.now,
    vaultIdeaFile: draftNote,
    vaultIdeaRelativeDir: config.vaultIdeaRelativeDir,
    status: options.execute ? "active" : "planned",
    parentIdentifier: entry.parentIdentifier,
    workflowRunId: entry.workflowRunId,
    canaryPath: entry.canaryPath,
  });

  return {
    ...entry,
    vaultRoot,
    vaultIdeaNote,
    skillCommand: "/skill:idea-to-build",
    nextSteps: [
      ...(entry.nextSteps ?? []),
      `Vault note: ${vaultIdeaNote}`,
      "python 4_Project/Multica-Agent-Strategy/Scripts/vault-split-commit.py --apply --push --json --trigger skill:idea-to-build",
    ],
  };
}

async function main() {
  const args = parseWorkflowVaultIdeaEntryArgs();
  const report = await runWorkflowVaultIdeaEntry({
    execute: args.execute,
    vaultRoot: args.vaultRoot,
    vaultIdeaFile: args.vaultIdeaFile,
    canaryPath: args.canaryPath,
    reuseDefaultCanary: args.reuseDefaultCanary,
    roughIdea: await loadRoughIdeaFromArgs(args),
    maxStageCycles: args.maxStageCycles,
    sessionSuffix: args.sessionSuffix,
    invocationToken: args.invocationToken,
    newSession: args.newSession,
    sessionsRoot: args.sessionsRoot,
    cwd: process.cwd(),
  });
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.verbose) {
    console.log(JSON.stringify(report, null, 2));
  } else if (report.ok) {
    console.log(`mode: ${report.mode}`);
    console.log(`vault note: ${report.vaultIdeaNote}`);
    console.log(`parent: ${report.parentIdentifier ?? "(planned)"}`);
    console.log(`workflowRunId: ${report.workflowRunId ?? "(planned)"}`);
  } else {
    console.log(`vault idea entry failed: ${report.error ?? report.step ?? "unknown"}`);
  }
  if (!report.ok) process.exitCode = 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
