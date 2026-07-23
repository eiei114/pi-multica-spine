import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * In-memory WorkflowLiveCli for offline examples (no `multica` binary).
 */
export function createFixtureLiveCli(projectId, parentIssueId) {
  const issues = new Map([
    [
      parentIssueId,
      { id: parentIssueId, project_id: projectId, identifier: "DOT-WALKTHROUGH" },
    ],
  ]);

  return {
    async verifyProject() {
      return { id: projectId };
    },
    async getIssue(id) {
      const issue = issues.get(id);
      if (!issue) throw new Error(`fixture live cli: missing issue ${id}`);
      return issue;
    },
    async createStageIssue(input) {
      const issue = {
        id: `issue_${input.stage}`,
        project_id: input.projectId,
        identifier: `DOT-${input.stage}`,
      };
      issues.set(issue.id, issue);
      return issue;
    },
    async assignStageIssue() {
      return issues.values().next().value;
    },
    async transitionStageIssue(id, status) {
      const issue = issues.get(id);
      if (issue) issues.set(id, { ...issue, status });
      return issues.get(id) ?? { id, status };
    },
    async writeParentSummary() {
      return {};
    },
    async writeStageWriteback() {
      return {};
    },
    async readRunMetadata() {
      return {};
    },
    async triggerAutopilot() {
      return {};
    },
  };
}

export async function bootstrapWalkthroughRepo(walkthroughRoot) {
  await mkdir(walkthroughRoot, { recursive: true });
  const pkg = {
    name: "pi-multica-spine-walkthrough",
    version: "0.0.0",
    private: true,
    type: "module",
    description: "Offline workflow campaign walkthrough target.",
  };
  const sampleJsonl = [
    '{"id":"t1","status":"open"}',
    '{"id":"t2","status":"done"}',
  ].join("\n");
  await writeFile(join(walkthroughRoot, "README.md"), "# Workflow campaign walkthrough\n", "utf8");
  await writeFile(join(walkthroughRoot, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  await writeFile(join(walkthroughRoot, "tasks.sample.jsonl"), `${sampleJsonl}\n`, "utf8");
}

export function buildWalkthroughBinding(multicaProjectId, manifest) {
  return {
    schemaVersion: 1,
    multicaProjectId,
    projectKey: "WALKTHROUGH",
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    artifactRoot: ".multica-spine/walkthrough-artifacts",
    enabledOptionalStages: [],
    projectGrants: ["design_doc", "implementation", "verification"],
    humanOwnedActions: [],
    roleRoutes: Object.fromEntries(
      manifest.roles.map((role) => [
        role,
        { agentId: "agent_walkthrough", capabilityProfile: role },
      ]),
    ),
    autoAdvancePolicy: "autonomous",
    executionMode: "autonomous_until_final",
    humanGate: "start_and_final",
    deliveryPolicy: {
      prRequired: false,
      releaseAllowed: false,
      productionAllowed: false,
      destructiveAllowed: false,
    },
    metadata: {
      walkthrough: "true",
      lane: "offline_campaign",
    },
  };
}
