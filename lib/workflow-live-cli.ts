import type { ParentWorkflowIssueSummary } from "./project-workflow-binding.ts";
import type { WorkflowArtifactEnvelope } from "./workflow-run-state.ts";
import {
  createAutopilotClient,
  createIssueClient,
  createMetadataClient,
  createProjectClient,
  inferMetadataType,
  type AutopilotClient,
  type CreateIssueInput,
  type IssueClient,
  type IssueRecord,
  type MetadataClient,
  type MetadataMap,
  type MetadataValue,
  type MulticaRunner,
  type ProjectClient,
  runMultica,
} from "./multica-cli.ts";

export const WORKFLOW_COMPLETION_AUTHORITY = "workflow_controller" as const;

export interface WorkflowStageIssueInput {
  title: string;
  description?: string;
  parentIssueId: string;
  stage?: number;
  projectId: string;
  assigneeId?: string;
  status?: string;
}

export interface WorkflowStageWritebackInput {
  issueIdentifier: string;
  prUrl?: string;
  prNumber?: number;
  prHeadSha?: string;
  prBranch?: string;
  artifact?: WorkflowArtifactEnvelope;
  extra?: Record<string, MetadataValue>;
}

export interface WorkflowLiveCli {
  verifyProject(projectId: string): Promise<Record<string, unknown>>;
  getIssue(issueIdentifier: string): Promise<IssueRecord>;
  createStageIssue(input: WorkflowStageIssueInput): Promise<IssueRecord>;
  assignStageIssue(issueIdentifier: string, assigneeId: string): Promise<IssueRecord>;
  transitionStageIssue(issueIdentifier: string, status: string): Promise<IssueRecord>;
  writeParentSummary(issueIdentifier: string, summary: ParentWorkflowIssueSummary): Promise<MetadataMap>;
  writeStageWriteback(input: WorkflowStageWritebackInput): Promise<MetadataMap>;
  readRunMetadata(issueIdentifier: string): Promise<MetadataMap>;
  triggerAutopilot(autopilotId: string): Promise<Record<string, unknown>>;
}

export class WorkflowProductGapError extends Error {
  readonly capability: string;
  readonly smallestAddition: string;

  constructor(capability: string, smallestAddition: string, cause?: Error) {
    super(`Multica product gap (${capability}): ${smallestAddition}${cause ? `: ${cause.message}` : ""}`);
    this.name = "WorkflowProductGapError";
    this.capability = capability;
    this.smallestAddition = smallestAddition;
  }
}

function isUnknownCommand(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown (command|flag)|command not found|not recognized as (?:an internal|a command)|no such command/i.test(message);
}

function productGapForUnknownCommand(error: unknown, capability: string, smallestAddition: string): never {
  if (isUnknownCommand(error)) {
    throw new WorkflowProductGapError(capability, smallestAddition, error instanceof Error ? error : undefined);
  }
  throw error;
}

async function writeMetadataKeys(
  metadata: MetadataClient,
  issueIdentifier: string,
  entries: Record<string, MetadataValue>,
): Promise<MetadataMap> {
  let latest: MetadataMap = {};
  for (const [key, value] of Object.entries(entries)) {
    latest = await metadata.set(issueIdentifier, key, value, inferMetadataType(value));
  }
  return latest;
}

export function parentSummaryMetadataEntries(summary: ParentWorkflowIssueSummary): Record<string, MetadataValue> {
  return {
    workflow_managed: summary.workflow_managed,
    workflow_run_id: summary.workflow_run_id,
    workflow_adapter_id: summary.workflow_adapter_id,
    workflow_adapter_version: summary.workflow_adapter_version,
    workflow_bundle_hash: summary.workflow_bundle_hash,
    workflow_stage: summary.workflow_stage,
    workflow_status: summary.workflow_status,
    workflow_state_pointer: summary.workflow_state_pointer,
    completion_authority: WORKFLOW_COMPLETION_AUTHORITY,
    needs_human_review: summary.needs_human_review,
    // Commit marker: readers must only trust the preceding snapshot fields with this hash.
    workflow_state_hash: summary.workflow_state_hash,
  };
}

export function stageWritebackMetadataEntries(input: WorkflowStageWritebackInput): Record<string, MetadataValue> {
  const reservedKeys = new Set([
    "completion_authority",
    "pr_url",
    "pr_number",
    "pr_head_sha",
    "pr_branch",
    "workflow_artifact_output_hash",
    "workflow_artifact_output_path",
    "workflow_artifact_stage_id",
    "workflow_artifact_producer_issue_id",
  ]);
  const entries: Record<string, MetadataValue> = {
    completion_authority: WORKFLOW_COMPLETION_AUTHORITY,
  };
  if (input.prUrl) entries.pr_url = input.prUrl;
  if (input.prNumber !== undefined) entries.pr_number = input.prNumber;
  if (input.prHeadSha) entries.pr_head_sha = input.prHeadSha;
  if (input.prBranch) entries.pr_branch = input.prBranch;
  if (input.artifact) {
    entries.workflow_artifact_output_hash = input.artifact.outputHash;
    entries.workflow_artifact_output_path = input.artifact.outputPath;
    entries.workflow_artifact_stage_id = input.artifact.stageId;
    entries.workflow_artifact_producer_issue_id = input.artifact.producerIssueId;
  }
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      if (reservedKeys.has(key)) continue;
      entries[key] = value;
    }
  }
  return entries;
}

export function createWorkflowLiveCli(runner: MulticaRunner = runMultica): WorkflowLiveCli {
  const issues = createIssueClient(runner);
  const metadata = createMetadataClient(runner);
  const projects = createProjectClient(runner);
  const autopilots = createAutopilotClient(runner);
  return buildWorkflowLiveCli(issues, metadata, projects, autopilots);
}

export function buildWorkflowLiveCli(
  issues: IssueClient,
  metadata: MetadataClient,
  projects: ProjectClient,
  autopilots: AutopilotClient,
): WorkflowLiveCli {
  return {
    async verifyProject(projectId) {
      try {
        return await projects.get(projectId);
      } catch (error) {
        productGapForUnknownCommand(error, "project.get", "Expose `multica project get <id> --output json` for binding validation.");
      }
    },
    async getIssue(issueIdentifier) {
      try {
        return await issues.get(issueIdentifier);
      } catch (error) {
        productGapForUnknownCommand(error, "issue.get", "Expose `multica issue get <id> --output json` for workflow issue validation.");
      }
    },
    async createStageIssue(input) {
      const createInput: CreateIssueInput = {
        title: input.title,
        description: input.description,
        parentIssueId: input.parentIssueId,
        stage: input.stage,
        projectId: input.projectId,
        assigneeId: input.assigneeId,
        status: input.status ?? "todo",
      };
      try {
        return await issues.create(createInput);
      } catch (error) {
        productGapForUnknownCommand(
          error,
          "issue.create",
          "Expose `multica issue create` with parent/stage/project/assignee-id flags for workflow stage seeding.",
        );
      }
    },
    async assignStageIssue(issueIdentifier, assigneeId) {
      try {
        return await issues.assign(issueIdentifier, assigneeId);
      } catch (error) {
        productGapForUnknownCommand(
          error,
          "issue.assign",
          "Expose `multica issue assign <id> --to-id <uuid> --output json` for workflow stage routing.",
        );
      }
    },
    async transitionStageIssue(issueIdentifier, status) {
      try {
        return await issues.setStatus(issueIdentifier, status);
      } catch (error) {
        productGapForUnknownCommand(
          error,
          "issue.status",
          "Expose `multica issue status <id> <status> --output json` for workflow stage transitions.",
        );
      }
    },
    async writeParentSummary(issueIdentifier, summary) {
      if (summary.completion_authority !== WORKFLOW_COMPLETION_AUTHORITY) {
        throw new Error(`Parent summary must set completion_authority=${WORKFLOW_COMPLETION_AUTHORITY}`);
      }
      try {
        return await writeMetadataKeys(metadata, issueIdentifier, parentSummaryMetadataEntries(summary));
      } catch (error) {
        productGapForUnknownCommand(error, "issue.metadata.set", "Expose issue metadata set for parent workflow summary writeback.");
      }
    },
    async writeStageWriteback(input) {
      try {
        return await writeMetadataKeys(metadata, input.issueIdentifier, stageWritebackMetadataEntries(input));
      } catch (error) {
        productGapForUnknownCommand(error, "issue.metadata.set", "Expose issue metadata set for workflow stage writeback.");
      }
    },
    async readRunMetadata(issueIdentifier) {
      try {
        return await metadata.list(issueIdentifier);
      } catch (error) {
        productGapForUnknownCommand(error, "issue.metadata.list", "Expose issue metadata list for workflow run state reads.");
      }
    },
    async triggerAutopilot(autopilotId) {
      try {
        return await autopilots.trigger(autopilotId);
      } catch (error) {
        productGapForUnknownCommand(
          error,
          "autopilot.trigger",
          "Expose `multica autopilot trigger <id> --output json` for controller execution paths.",
        );
      }
    },
  };
}

/** Default live workflow CLI bridge backed by the real `multica` executable. */
export const workflowLiveCli: WorkflowLiveCli = createWorkflowLiveCli();
