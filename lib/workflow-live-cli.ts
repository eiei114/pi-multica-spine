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
  assigneeId: string;
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
  return /unknown (command|flag)|not (found|recognized)|no such command/i.test(message);
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
    workflow_state_hash: summary.workflow_state_hash,
    completion_authority: WORKFLOW_COMPLETION_AUTHORITY,
    needs_human_review: summary.needs_human_review,
  };
}

export function stageWritebackMetadataEntries(input: WorkflowStageWritebackInput): Record<string, MetadataValue> {
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
        if (isUnknownCommand(error)) {
          throw new WorkflowProductGapError("project.get", "Expose `multica project get <id> --output json` for binding validation.");
        }
        throw error;
      }
    },
    async getIssue(issueIdentifier) {
      return issues.get(issueIdentifier);
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
        if (isUnknownCommand(error)) {
          throw new WorkflowProductGapError(
            "issue.create",
            "Expose `multica issue create` with parent/stage/project/assignee-id flags for workflow stage seeding.",
            error instanceof Error ? error : undefined,
          );
        }
        throw error;
      }
    },
    async assignStageIssue(issueIdentifier, assigneeId) {
      try {
        return await issues.assign(issueIdentifier, assigneeId);
      } catch (error) {
        if (isUnknownCommand(error)) {
          throw new WorkflowProductGapError(
            "issue.assign",
            "Expose `multica issue assign <id> --to-id <uuid> --output json` for workflow stage routing.",
            error instanceof Error ? error : undefined,
          );
        }
        throw error;
      }
    },
    async transitionStageIssue(issueIdentifier, status) {
      try {
        return await issues.setStatus(issueIdentifier, status);
      } catch (error) {
        if (isUnknownCommand(error)) {
          throw new WorkflowProductGapError(
            "issue.status",
            "Expose `multica issue status <id> <status> --output json` for workflow stage transitions.",
            error instanceof Error ? error : undefined,
          );
        }
        throw error;
      }
    },
    async writeParentSummary(issueIdentifier, summary) {
      if (summary.completion_authority !== WORKFLOW_COMPLETION_AUTHORITY) {
        throw new Error(`Parent summary must set completion_authority=${WORKFLOW_COMPLETION_AUTHORITY}`);
      }
      return writeMetadataKeys(metadata, issueIdentifier, parentSummaryMetadataEntries(summary));
    },
    async writeStageWriteback(input) {
      return writeMetadataKeys(metadata, input.issueIdentifier, stageWritebackMetadataEntries(input));
    },
    async readRunMetadata(issueIdentifier) {
      return metadata.list(issueIdentifier);
    },
    async triggerAutopilot(autopilotId) {
      try {
        return await autopilots.trigger(autopilotId);
      } catch (error) {
        if (isUnknownCommand(error)) {
          throw new WorkflowProductGapError(
            "autopilot.trigger",
            "Expose `multica autopilot trigger <id> --output json` for controller execution paths.",
            error instanceof Error ? error : undefined,
          );
        }
        throw error;
      }
    },
  };
}

/** Default live workflow CLI bridge backed by the real `multica` executable. */
export const workflowLiveCli: WorkflowLiveCli = createWorkflowLiveCli();
