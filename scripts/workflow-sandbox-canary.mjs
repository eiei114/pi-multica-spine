#!/usr/bin/env node
import { parseArgs } from "node:util";

const CANARY_PROJECT_NAME = "pi-multica-spine Idea-to-Build Canary";
const DEFAULT_CANARY_PATH = "C:/Users/Keisu/Projects/Sandbox/pi-multica-spine-idea-to-build-canary";

export function parseWorkflowSandboxCanaryArgs(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "dry-run": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
      resume: { type: "string" },
      fixture: { type: "string" },
      report: { type: "boolean", default: false },
      "canary-path": { type: "string", default: DEFAULT_CANARY_PATH },
      "project-id": { type: "string" },
    },
    allowPositionals: false,
  });
  return {
    dryRun: values["dry-run"] ?? false,
    apply: values.apply ?? false,
    resumeRunId: values.resume,
    fixture: values.fixture,
    report: values.report ?? false,
    canaryPath: values["canary-path"] ?? DEFAULT_CANARY_PATH,
    projectId: values["project-id"],
  };
}

export function buildSandboxCanaryPlan(config = parseWorkflowSandboxCanaryArgs()) {
  if (config.projectId && !config.dryRun && !config.report) {
    throw new Error(`Refusing sandbox command with explicit production-like project id: ${config.projectId}`);
  }
  return {
    projectName: CANARY_PROJECT_NAME,
    canaryPath: config.canaryPath,
    mode: config.report ? "report" : config.apply ? "apply" : config.resumeRunId ? "resume" : "dry-run",
    resumeRunId: config.resumeRunId,
    fixture: config.fixture,
    deliveryPolicy: {
      prRequired: false,
      releaseAllowed: false,
      productionAllowed: false,
      destructiveAllowed: false,
    },
    roughIdea:
      "Build a small TypeScript CLI that reads JSONL task records and outputs status counts plus a stable SHA-256 digest as JSON.",
    unresolvedPreference: "Whether human-readable summary output should use color remains unresolved.",
    artifactRootTemplate: ".multica-spine/canary-artifacts/<workflow-run-id>",
    finalPackageFiles: [
      "00-executive-summary.md",
      "01-run-index.json",
      "02-artifact-lineage.json",
      "03-routing-evidence.json",
      "04-autopilot-evidence.json",
      "05-test-evidence.md",
      "06-failure-fixtures.md",
      "07-assumptions-and-open-questions.md",
      "08-human-actions-remaining.md",
      "09-operations-handoff.md",
    ],
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const plan = buildSandboxCanaryPlan();
  console.log(JSON.stringify(plan, null, 2));
}
