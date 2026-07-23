import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { relative, resolve } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "../lib/schema.ts";
import {
  assertValidProjectWorkflowBinding,
  createParentWorkflowIssueSummary,
  ProjectWorkflowBindingSchema,
  type ProjectWorkflowBinding,
  WorkflowIssueStatusSchema,
} from "../lib/project-workflow-binding.ts";
import { ProjectWorkflowBindingStore } from "../lib/project-workflow-binding-store.ts";
import {
  buildGuardedGitNetworkBashCommand,
  gitNetworkWallClockTimeoutSeconds,
  isGitNetworkShellCommand,
} from "../lib/git-network-guard.ts";
import {
  SpineStateStore,
  type BindInput,
  type EvidenceInput,
  type HandoffInput,
  type LinkPrInput,
} from "../lib/state-store.ts";
import type { SpineContextSnapshot } from "../lib/types.ts";
import {
  createMetadataClient,
  runMultica,
  type MetadataClient,
  type MetadataMap,
  type MetadataValue,
  type MetadataValueType,
} from "../lib/multica-cli.ts";
import {
  canAcceptProducedStage,
  computeEffectivePermission,
  resolveNextStageId,
  seedWorkflowStage,
  summarizeControllerState,
  transitionWorkflowStage,
} from "../lib/workflow-controller.ts";
import {
  type WorkflowCatalogEntry,
  type WorkflowCatalogManifest,
  WorkflowCatalogManifestSchema,
  WorkflowCatalogStatusSchema,
} from "../lib/workflow-catalog.ts";
import { WorkflowCatalogStore } from "../lib/workflow-catalog-store.ts";
import {
  hashWorkflowRunLedger,
  type WorkflowArtifactEnvelope,
  WorkflowArtifactEnvelopeSchema,
  type WorkflowQuestionRecord,
  WorkflowQuestionRecordSchema,
  type WorkflowRunStateLedger,
  WorkflowRunStateStore,
  type WorkflowStageState,
  type WorkflowStageStatus,
  WorkflowStageStatusSchema,
} from "../lib/workflow-run-state.ts";

// Metadata CLI client. Overridable via _setMetadataClientForTests for unit tests;
// production uses the real `multica` CLI-backed client.
let metadataClient: MetadataClient = createMetadataClient(runMultica);

/** @internal Test seam to inject a fake metadata client without spawning the CLI. */
export function _setMetadataClientForTests(client: MetadataClient): void {
  metadataClient = client;
}

const CONTRACT = `You are acting as a Multica Work Agent.

For Multica implementation or PR-producing work:
1. Bind the active issue identifier with multica_spine_bind.
2. Use multica_spine_next to see the required next action.
3. Ensure PRs reference the bound issue identifier.
4. If a linked local issue markdown exists, set ready_for_multica: false before reporting done so import does not re-queue completed work.
5. Do not report done until multica_spine_verify passes.`;

const bindParameters = Type.Object({
  issueIdentifier: Type.String({ description: "Opaque Multica issue identifier. Do not assume DOT format." }),
  issueUrl: Type.Optional(Type.String({ description: "Optional source issue URL." })),
  issueTitle: Type.Optional(Type.String({ description: "Optional source issue title." })),
  localIssuePath: Type.Optional(Type.String({ description: "Optional relative path to the linked local issue markdown." })),
});

const linkPrParameters = Type.Object({
  prUrl: Type.String({ description: "Pull request URL." }),
  prNumber: Type.Optional(Type.Number({ description: "Pull request number." })),
  prHeadSha: Type.Optional(Type.String({ description: "PR head commit SHA." })),
  prBranch: Type.Optional(Type.String({ description: "PR branch name." })),
  prTitle: Type.Optional(Type.String({ description: "PR title." })),
  prBody: Type.Optional(Type.String({ description: "PR body. Recommended line: Multica Issue: <issue-identifier>." })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Extra PR/source issue metadata." })),
  writebackRecorded: Type.Optional(Type.Boolean({ description: "True after PR binding is written back or manually recorded on the source issue." })),
});

const evidenceParameters = Type.Object({
  kind: StringEnum(["command", "manual", "test", "lint", "typecheck"], { description: "Evidence type." }),
  command: Type.Optional(Type.String({ description: "Verification command, if applicable." })),
  exitCode: Type.Optional(Type.Number({ description: "Command exit code. Failed checks are allowed." })),
  summary: Type.String({ description: "Short outcome summary." }),
  outputExcerpt: Type.Optional(Type.String({ description: "Relevant output excerpt." })),
});

const handoffParameters = Type.Object({
  done: Type.Array(Type.String(), { description: "Completed work. Include the issue identifier." }),
  changed: Type.Array(Type.String(), { description: "Files/modules/behavior changed." }),
  verification: Type.Array(Type.String(), { description: "Verification performed. Include PR URL when available." }),
  blockers: Type.Optional(Type.Array(Type.String({ description: "Known blocker." }))),
  next: Type.Optional(Type.Array(Type.String({ description: "Next action." }))),
  risks: Type.Optional(Type.Array(Type.String({ description: "Residual risk." }))),
});

const metadataIssueIdentifier = Type.Optional(
  Type.String({
    description: "Opaque Multica issue identifier (UUID or key like DOT-762). Defaults to the bound issue.",
  }),
);

const metadataListParameters = Type.Object({
  issueIdentifier: metadataIssueIdentifier,
});

const metadataSetParameters = Type.Object({
  issueIdentifier: metadataIssueIdentifier,
  key: Type.String({ description: "Metadata key (snake_case ASCII recommended, e.g. pr_url)." }),
  value: Type.Union([Type.String(), Type.Number(), Type.Boolean()], {
    description: "Metadata value. Stored type matches the JS type by default; pass `type` to override.",
  }),
  type: Type.Optional(
    StringEnum(["string", "number", "bool"], {
      description: "Force value type: string, number, or bool. Defaults to the JS type of `value`.",
    }),
  ),
});

const metadataDeleteParameters = Type.Object({
  issueIdentifier: metadataIssueIdentifier,
  key: Type.String({ description: "Metadata key to remove. Deleting a missing key is a no-op." }),
});

const catalogPutParameters = Type.Object({
  manifest: WorkflowCatalogManifestSchema,
});

const catalogGetParameters = Type.Object({
  adapterId: Type.String({ minLength: 1 }),
  adapterVersion: Type.Integer({ minimum: 1 }),
});

const catalogTransitionParameters = Type.Object({
  adapterId: Type.String({ minLength: 1 }),
  adapterVersion: Type.Integer({ minimum: 1 }),
  status: WorkflowCatalogStatusSchema,
});

const bindingPutParameters = Type.Object({
  binding: ProjectWorkflowBindingSchema,
});

const bindingGetParameters = Type.Object({
  projectIdOrKey: Type.String({ minLength: 1 }),
});

const parentSummaryParameters = Type.Object({
  projectIdOrKey: Type.String({ minLength: 1 }),
  workflowRunId: Type.String({ minLength: 1 }),
  workflowStage: Type.String({ minLength: 1 }),
  workflowStatus: WorkflowIssueStatusSchema,
  workflowStatePointer: Type.Optional(Type.String({ minLength: 1 })),
  workflowStateHash: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  workflowBundleHash: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  needsHumanReview: Type.Optional(Type.Boolean()),
});

const workflowRunCreateParameters = Type.Object({
  projectIdOrKey: Type.String({ minLength: 1 }),
  workflowRunId: Type.String({ minLength: 1 }),
  initialStageId: Type.Optional(Type.String({ minLength: 1 })),
});

const workflowRunContextParameters = Type.Object({
  workflowRunId: Type.String({ minLength: 1 }),
});

const workflowStageSeedParameters = Type.Object({
  workflowRunId: Type.String({ minLength: 1 }),
  stageId: Type.Optional(Type.String({ minLength: 1 })),
  attempt: Type.Optional(Type.Integer({ minimum: 1 })),
  issueId: Type.Optional(Type.String({ minLength: 1 })),
  assignedAgentId: Type.Optional(Type.String({ minLength: 1 })),
});

const workflowStageTransitionParameters = Type.Object({
  workflowRunId: Type.String({ minLength: 1 }),
  stageId: Type.String({ minLength: 1 }),
  status: WorkflowStageStatusSchema,
});

const workflowArtifactRecordParameters = Type.Object({
  workflowRunId: Type.String({ minLength: 1 }),
  artifact: WorkflowArtifactEnvelopeSchema,
});

const workflowQuestionRecordParameters = Type.Object({
  workflowRunId: Type.String({ minLength: 1 }),
  question: WorkflowQuestionRecordSchema,
});

const workflowPermissionCheckParameters = Type.Object({
  adapterRequest: Type.Array(Type.String({ minLength: 1 })),
  projectGrant: Type.Array(Type.String({ minLength: 1 })),
  stageGrant: Type.Array(Type.String({ minLength: 1 })),
  issueBoundary: Type.Array(Type.String({ minLength: 1 })),
  agentCapability: Type.Array(Type.String({ minLength: 1 })),
});

function storeFor(ctx: ExtensionContext): SpineStateStore {
  return new SpineStateStore(ctx.cwd);
}

function workflowCatalogStoreFor(ctx: ExtensionContext): WorkflowCatalogStore {
  return new WorkflowCatalogStore(ctx.cwd);
}

function workflowBindingStoreFor(ctx: ExtensionContext): ProjectWorkflowBindingStore {
  return new ProjectWorkflowBindingStore(ctx.cwd);
}

function workflowRunStoreFor(ctx: ExtensionContext): WorkflowRunStateStore {
  return new WorkflowRunStateStore(ctx.cwd);
}

async function mutateSpine<T>(ctx: ExtensionContext, fn: () => Promise<T>): Promise<T> {
  return withFileMutationQueue(resolve(ctx.cwd, ".multica-spine", "current.json"), fn);
}

async function mutateWorkflow<T>(ctx: ExtensionContext, fn: () => Promise<T>): Promise<T> {
  return withFileMutationQueue(resolve(ctx.cwd, ".multica-spine", "workflow-controller.json"), fn);
}

function summarize(snapshot: SpineContextSnapshot): string {
  const lines: string[] = [];
  const { task, evaluation } = snapshot;
  lines.push(`status: ${evaluation.status}`);
  lines.push(`verified: ${evaluation.verified ? "yes" : "no"}`);
  if (task) {
    lines.push(`issue: ${task.issue.identifier}`);
    if (task.pr?.prUrl) lines.push(`pr: ${task.pr.prUrl}`);
    lines.push(`evidence: ${task.evidence.length}`);
    lines.push(`handoff: ${task.handoff ? "yes" : "no"}`);
  }
  if (evaluation.missing.length > 0) lines.push(`missing: ${evaluation.missing.join(", ")}`);
  lines.push(`next: ${evaluation.nextAction.tool} - ${evaluation.nextAction.instruction}`);
  if (evaluation.prRecommendation) lines.push(`recommended_pr_body: ${evaluation.prRecommendation}`);
  return lines.join("\n");
}

function result(snapshot: SpineContextSnapshot) {
  return {
    content: [{ type: "text" as const, text: summarize(snapshot) }],
    details: snapshot,
  };
}

function normalizeBindArgs(args: unknown): BindInput {
  if (!args || typeof args !== "object") return args as BindInput;
  const input = args as Record<string, unknown>;
  return {
    ...input,
    issueIdentifier: input.issueIdentifier ?? input.issue_identifier,
    issueUrl: input.issueUrl ?? input.issue_url,
    issueTitle: input.issueTitle ?? input.issue_title,
    localIssuePath: input.localIssuePath ?? input.local_issue_path,
  } as BindInput;
}

function normalizeLinkPrArgs(args: unknown): LinkPrInput {
  if (!args || typeof args !== "object") return args as LinkPrInput;
  const input = args as Record<string, unknown>;
  return {
    ...input,
    prUrl: input.prUrl ?? input.pr_url,
    prNumber: input.prNumber ?? input.pr_number,
    prHeadSha: input.prHeadSha ?? input.pr_head_sha,
    prBranch: input.prBranch ?? input.pr_branch,
    prTitle: input.prTitle ?? input.pr_title,
    prBody: input.prBody ?? input.pr_body,
    writebackRecorded: input.writebackRecorded ?? input.writeback_recorded,
  } as LinkPrInput;
}

function normalizeMetadataArgs<T>(args: unknown): T {
  if (!args || typeof args !== "object") return (args ?? {}) as T;
  const input = args as Record<string, unknown>;
  return {
    ...input,
    issueIdentifier: input.issueIdentifier ?? input.issue_identifier,
  } as T;
}

async function resolveIssueIdentifier(ctx: ExtensionContext, provided: unknown): Promise<string> {
  const trimmed = typeof provided === "string" ? provided.trim() : "";
  if (trimmed) return trimmed;
  const current = await storeFor(ctx).loadCurrent();
  if (!current) {
    throw new Error(
      "issueIdentifier is required (no bound issue found; call multica_spine_bind first, or pass issueIdentifier explicitly).",
    );
  }
  return current.issueIdentifier;
}

function summarizeMetadata(action: string, issueIdentifier: string, metadata: MetadataMap): string {
  const entries = Object.entries(metadata);
  const lines = [`issue: ${issueIdentifier}`, `action: ${action}`, `keys: ${entries.length}`];
  for (const [key, value] of entries) {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return lines.join("\n");
}

function metadataResult(action: string, issueIdentifier: string, metadata: MetadataMap) {
  return {
    content: [{ type: "text" as const, text: summarizeMetadata(action, issueIdentifier, metadata) }],
    details: { action, issueIdentifier, metadata },
  };
}

function workflowCatalogResult(action: string, entryOrEntries: WorkflowCatalogEntry | WorkflowCatalogEntry[]) {
  const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
  const lines = [`action: ${action}`, `entries: ${entries.length}`];
  for (const entry of entries) {
    lines.push(`${entry.manifest.adapterId}@${entry.manifest.adapterVersion} -> ${entry.status}`);
  }
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { action, entries },
  };
}

function workflowBindingResult(action: string, bindingOrBindings: ProjectWorkflowBinding | ProjectWorkflowBinding[]) {
  const bindings = Array.isArray(bindingOrBindings) ? bindingOrBindings : [bindingOrBindings];
  const lines = [`action: ${action}`, `bindings: ${bindings.length}`];
  for (const binding of bindings) {
    lines.push(`${binding.multicaProjectId} -> ${binding.adapterId}@${binding.adapterVersion}`);
  }
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { action, bindings },
  };
}

function workflowRunResult(action: string, ledger: WorkflowRunStateLedger) {
  const summary = summarizeControllerState(ledger);
  const lines = [
    `action: ${action}`,
    `workflowRunId: ${summary.workflowRunId}`,
    `workflowStatus: ${summary.workflowStatus}`,
    `currentStageId: ${summary.currentStageId ?? "-"}`,
    `stages: ${summary.stageCount}`,
    `artifacts: ${summary.artifactCount}`,
    `questions: ${summary.questionCount}`,
    `stateVersion: ${summary.stateVersion}`,
  ];
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details: { action, ledger, summary, stateHash: hashWorkflowRunLedger(ledger) },
  };
}

async function resolveBindingAndManifest(ctx: ExtensionContext, projectIdOrKey: string): Promise<{
  binding: ProjectWorkflowBinding;
  catalogEntry: WorkflowCatalogEntry;
  manifest: WorkflowCatalogManifest;
}> {
  const binding = await workflowBindingStoreFor(ctx).get(projectIdOrKey);
  if (!binding) throw new Error(`Workflow binding not found: ${projectIdOrKey}`);
  const catalogEntry = await workflowCatalogStoreFor(ctx).get(binding.adapterId, binding.adapterVersion);
  if (!catalogEntry) throw new Error(`Workflow catalog entry not found: ${binding.adapterId}@${binding.adapterVersion}`);
  if (catalogEntry.status !== "active") {
    throw new Error(`Workflow adapter is not active: ${binding.adapterId}@${binding.adapterVersion} (${catalogEntry.status})`);
  }
  return { binding, catalogEntry, manifest: catalogEntry.manifest };
}

async function resolveManifestForLedger(ctx: ExtensionContext, ledger: WorkflowRunStateLedger): Promise<WorkflowCatalogManifest> {
  const entry = await workflowCatalogStoreFor(ctx).get(ledger.adapterId, ledger.adapterVersion);
  if (!entry) throw new Error(`Workflow catalog entry not found: ${ledger.adapterId}@${ledger.adapterVersion}`);
  return entry.manifest;
}

function toStageUpsertInput(stage: WorkflowStageState) {
  return {
    stageId: stage.stageId,
    status: stage.status,
    attempt: stage.attempt,
    issueId: stage.issueId,
    assignedAgentId: stage.assignedAgentId,
    artifactHashes: stage.artifactHashes,
  };
}

function portableRelativePath(from: string, to: string): string {
  return relative(from, to).replace(/\\/g, "/");
}

function pathWithinArtifactRoot(outputPath: string, artifactRoot: string): boolean {
  const cleanOutput = outputPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const cleanRoot = artifactRoot.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  return cleanOutput === cleanRoot || cleanOutput.startsWith(`${cleanRoot}/`);
}

export default function multicaSpineExtension(pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {});

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("multica-spine", "Multica spine ready");
    }
  });

  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${CONTRACT}` };
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash" || typeof event.input.command !== "string") {
      return undefined;
    }
    if (!isGitNetworkShellCommand(event.input.command)) {
      return undefined;
    }

    event.input.command = buildGuardedGitNetworkBashCommand(event.input.command);
    if (event.input.timeout === undefined) {
      event.input.timeout = gitNetworkWallClockTimeoutSeconds();
    }
    return undefined;
  });

  pi.registerTool({
    name: "multica_spine_bind",
    label: "Multica Spine Bind",
    description: "Bind the active Multica issue identifier for this work session.",
    promptSnippet: "multica_spine_bind: bind opaque Multica issue identifier before implementation or PR work",
    promptGuidelines: [
      "Use multica_spine_bind before PR-producing Multica work so later PR, evidence, and handoff checks share one issue identifier.",
    ],
    parameters: bindParameters,
    prepareArguments: normalizeBindArgs,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const snapshot = await mutateSpine(ctx, () => storeFor(ctx).bind(params as BindInput));
      return result(snapshot);
    },
  });

  pi.registerTool({
    name: "multica_spine_context",
    label: "Multica Spine Context",
    description: "Show current Multica work-agent binding, PR, evidence, handoff, and verification state.",
    promptSnippet: "multica_spine_context: inspect current Multica spine state",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return result(await storeFor(ctx).context());
    },
  });

  pi.registerTool({
    name: "multica_spine_next",
    label: "Multica Spine Next",
    description: "Return current state and next required Multica work-agent action.",
    promptSnippet: "multica_spine_next: get next required Multica work-agent action",
    promptGuidelines: ["Use multica_spine_next whenever Multica PR-producing work is unclear or before completion."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      return result(await storeFor(ctx).context());
    },
  });

  pi.registerTool({
    name: "multica_spine_link_pr",
    label: "Multica Spine Link PR",
    description: "Record PR URL and metadata, including writeback status to source Multica issue.",
    promptSnippet: "multica_spine_link_pr: record PR URL, metadata, and source issue writeback",
    promptGuidelines: [
      "Use multica_spine_link_pr after opening a PR; ensure branch, title, body, or metadata references the bound issue identifier.",
    ],
    parameters: linkPrParameters,
    prepareArguments: normalizeLinkPrArgs,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const snapshot = await mutateSpine(ctx, () => storeFor(ctx).linkPr(params as LinkPrInput));
      return result(snapshot);
    },
  });

  pi.registerTool({
    name: "multica_spine_add_evidence",
    label: "Multica Spine Evidence",
    description: "Record verification evidence with outcome and timestamp.",
    promptSnippet: "multica_spine_add_evidence: record verification command or manual evidence",
    parameters: evidenceParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const snapshot = await mutateSpine(ctx, () => storeFor(ctx).addEvidence(params as EvidenceInput));
      return result(snapshot);
    },
  });

  pi.registerTool({
    name: "multica_spine_handoff",
    label: "Multica Spine Handoff",
    description: "Record structured handoff for reviewer or next agent before reporting done.",
    promptSnippet: "multica_spine_handoff: record structured done/changed/verification/blockers/next handoff",
    parameters: handoffParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const snapshot = await mutateSpine(ctx, () => storeFor(ctx).handoff(params as HandoffInput));
      return result(snapshot);
    },
  });

  pi.registerTool({
    name: "multica_spine_verify",
    label: "Multica Spine Verify",
    description: "Check active issue, PR binding, writeback, evidence, and handoff completeness.",
    promptSnippet: "multica_spine_verify: completion gate for Multica issue/PR/evidence/handoff spine",
    promptGuidelines: ["Do not report Multica PR-producing work done until multica_spine_verify reports verified: yes."],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const snapshot = await mutateSpine(ctx, () => storeFor(ctx).verify());
      return result(snapshot);
    },
  });

  pi.registerTool({
    name: "multica_spine_metadata_list",
    label: "Multica Spine Metadata List",
    description: "List all metadata keys on a Multica issue via `multica issue metadata list --output json`.",
    promptSnippet: "multica_spine_metadata_list: read all per-issue metadata keys from Multica",
    parameters: metadataListParameters,
    prepareArguments: normalizeMetadataArgs,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const issueIdentifier = await resolveIssueIdentifier(ctx, (params as { issueIdentifier?: string }).issueIdentifier);
      const metadata = await metadataClient.list(issueIdentifier);
      return metadataResult("metadata_list", issueIdentifier, metadata);
    },
  });

  pi.registerTool({
    name: "multica_spine_metadata_set",
    label: "Multica Spine Metadata Set",
    description: "Set a single metadata key on a Multica issue via `multica issue metadata set --output json`.",
    promptSnippet: "multica_spine_metadata_set: write one per-issue metadata key/value on Multica",
    promptGuidelines: [
      "Prefer snake_case ASCII metadata keys. The stored type matches the JS type of `value` unless `type` overrides it.",
    ],
    parameters: metadataSetParameters,
    prepareArguments: normalizeMetadataArgs,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { issueIdentifier?: string; key: string; value: MetadataValue; type?: MetadataValueType };
      const issueIdentifier = await resolveIssueIdentifier(ctx, args.issueIdentifier);
      const metadata = await metadataClient.set(issueIdentifier, args.key, args.value, args.type);
      return metadataResult("metadata_set", issueIdentifier, metadata);
    },
  });

  pi.registerTool({
    name: "multica_spine_metadata_delete",
    label: "Multica Spine Metadata Delete",
    description: "Delete a single metadata key on a Multica issue via `multica issue metadata delete --output json`.",
    promptSnippet: "multica_spine_metadata_delete: remove one per-issue metadata key on Multica",
    parameters: metadataDeleteParameters,
    prepareArguments: normalizeMetadataArgs,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { issueIdentifier?: string; key: string };
      const issueIdentifier = await resolveIssueIdentifier(ctx, args.issueIdentifier);
      const metadata = await metadataClient.delete(issueIdentifier, args.key);
      return metadataResult("metadata_delete", issueIdentifier, metadata);
    },
  });

  pi.registerTool({
    name: "multica_workflow_catalog_put",
    label: "Multica Workflow Catalog Put",
    description: "Validate and persist one workflow catalog entry for the adapter-contract control plane.",
    parameters: catalogPutParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { manifest: WorkflowCatalogManifest };
      const entry = await mutateWorkflow(ctx, () => workflowCatalogStoreFor(ctx).upsert(args.manifest));
      return workflowCatalogResult("catalog_put", entry);
    },
  });

  pi.registerTool({
    name: "multica_workflow_catalog_get",
    label: "Multica Workflow Catalog Get",
    description: "Read one persisted workflow catalog entry by adapter id and version.",
    parameters: catalogGetParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { adapterId: string; adapterVersion: number };
      const entry = await workflowCatalogStoreFor(ctx).get(args.adapterId, args.adapterVersion);
      if (!entry) throw new Error(`Workflow catalog entry not found: ${args.adapterId}@${args.adapterVersion}`);
      return workflowCatalogResult("catalog_get", entry);
    },
  });

  pi.registerTool({
    name: "multica_workflow_catalog_list",
    label: "Multica Workflow Catalog List",
    description: "List persisted workflow catalog entries in repo-local state.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const entries = await workflowCatalogStoreFor(ctx).list();
      return workflowCatalogResult("catalog_list", entries);
    },
  });

  pi.registerTool({
    name: "multica_workflow_catalog_transition",
    label: "Multica Workflow Catalog Transition",
    description: "Transition a workflow catalog entry through quarantined/audited/active/deprecated/revoked.",
    parameters: catalogTransitionParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { adapterId: string; adapterVersion: number; status: WorkflowCatalogEntry["status"] };
      const entry = await mutateWorkflow(ctx, () => workflowCatalogStoreFor(ctx).transition(args.adapterId, args.adapterVersion, args.status));
      return workflowCatalogResult("catalog_transition", entry);
    },
  });

  pi.registerTool({
    name: "multica_workflow_binding_put",
    label: "Multica Workflow Binding Put",
    description: "Validate and persist one project workflow binding.",
    parameters: bindingPutParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { binding: ProjectWorkflowBinding };
      const entry = await workflowCatalogStoreFor(ctx).get(args.binding.adapterId, args.binding.adapterVersion);
      if (!entry) throw new Error(`Workflow catalog entry not found: ${args.binding.adapterId}@${args.binding.adapterVersion}`);
      if (entry.status !== "active") {
        throw new Error(`Cannot bind inactive workflow adapter: ${args.binding.adapterId}@${args.binding.adapterVersion} (${entry.status})`);
      }
      const binding = assertValidProjectWorkflowBinding(args.binding, entry.manifest);
      await mutateWorkflow(ctx, () => workflowBindingStoreFor(ctx).save(binding));
      return workflowBindingResult("binding_put", binding);
    },
  });

  pi.registerTool({
    name: "multica_workflow_binding_get",
    label: "Multica Workflow Binding Get",
    description: "Read one persisted workflow binding by project id or project key.",
    parameters: bindingGetParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { projectIdOrKey: string };
      const binding = await workflowBindingStoreFor(ctx).get(args.projectIdOrKey);
      if (!binding) throw new Error(`Workflow binding not found: ${args.projectIdOrKey}`);
      return workflowBindingResult("binding_get", binding);
    },
  });

  pi.registerTool({
    name: "multica_workflow_binding_list",
    label: "Multica Workflow Binding List",
    description: "List persisted workflow bindings in repo-local state.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const bindings = await workflowBindingStoreFor(ctx).list();
      return workflowBindingResult("binding_list", bindings);
    },
  });

  pi.registerTool({
    name: "multica_workflow_parent_summary",
    label: "Multica Workflow Parent Summary",
    description: "Build the compact parent workflow issue summary from a binding and workflow run state.",
    parameters: parentSummaryParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as {
        projectIdOrKey: string;
        workflowRunId: string;
        workflowStage: string;
        workflowStatus: "pending" | "waiting" | "running" | "blocked" | "failed" | "completed";
        workflowStatePointer?: string;
        workflowStateHash?: string;
        workflowBundleHash?: string;
        needsHumanReview?: boolean;
      };
      const { binding, catalogEntry } = await resolveBindingAndManifest(ctx, args.projectIdOrKey);
      const existingLedger = await workflowRunStoreFor(ctx).load(args.workflowRunId);
      if (!existingLedger) throw new Error(`Workflow run not found: ${args.workflowRunId}`);
      const statePointer = args.workflowStatePointer || portableRelativePath(ctx.cwd, workflowRunStoreFor(ctx).ledgerPath(args.workflowRunId));
      const summary = createParentWorkflowIssueSummary({
        binding,
        workflowRunId: args.workflowRunId,
        workflowBundleHash: args.workflowBundleHash ?? catalogEntry.manifest.derivedBundleHash,
        workflowStage: args.workflowStage,
        workflowStatus: args.workflowStatus,
        workflowStatePointer: statePointer,
        workflowStateHash: args.workflowStateHash ?? hashWorkflowRunLedger(existingLedger),
        needsHumanReview: args.needsHumanReview,
      });
      return {
        content: [{ type: "text" as const, text: `workflowRunId: ${summary.workflow_run_id}\nworkflowStage: ${summary.workflow_stage}\nworkflowStatus: ${summary.workflow_status}` }],
        details: { summary },
      };
    },
  });

  pi.registerTool({
    name: "multica_workflow_run_create",
    label: "Multica Workflow Run Create",
    description: "Create one repo-local workflow run ledger from a persisted binding and catalog entry.",
    parameters: workflowRunCreateParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { projectIdOrKey: string; workflowRunId: string; initialStageId?: string };
      const { binding, manifest, catalogEntry } = await resolveBindingAndManifest(ctx, args.projectIdOrKey);
      const initialStageId = args.initialStageId ?? resolveNextStageId(manifest);
      const store = workflowRunStoreFor(ctx);
      let ledger = await mutateWorkflow(ctx, () =>
        store.create({
          workflowRunId: args.workflowRunId,
          multicaProjectId: binding.multicaProjectId,
          adapterId: binding.adapterId,
          adapterVersion: binding.adapterVersion,
          adapterBundleHash: catalogEntry.manifest.derivedBundleHash,
          executionMode: binding.executionMode,
        }),
      );
      if (initialStageId && !ledger.currentStageId) {
        const stage = seedWorkflowStage(ledger, manifest, binding, { stageId: initialStageId, attempt: 1 });
        ledger = await mutateWorkflow(ctx, () => store.upsertStage(args.workflowRunId, toStageUpsertInput(stage)));
      }
      return workflowRunResult("workflow_run_create", ledger);
    },
  });

  pi.registerTool({
    name: "multica_workflow_run_context",
    label: "Multica Workflow Run Context",
    description: "Read one repo-local workflow run ledger and summary.",
    parameters: workflowRunContextParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { workflowRunId: string };
      const ledger = await workflowRunStoreFor(ctx).load(args.workflowRunId);
      if (!ledger) throw new Error(`Workflow run not found: ${args.workflowRunId}`);
      return workflowRunResult("workflow_run_context", ledger);
    },
  });

  pi.registerTool({
    name: "multica_workflow_stage_seed",
    label: "Multica Workflow Stage Seed",
    description: "Seed the next or specified workflow stage using the binding's role route and manifest order.",
    parameters: workflowStageSeedParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { workflowRunId: string; stageId?: string; attempt?: number; issueId?: string; assignedAgentId?: string };
      const store = workflowRunStoreFor(ctx);
      const ledger = await store.load(args.workflowRunId);
      if (!ledger) throw new Error(`Workflow run not found: ${args.workflowRunId}`);
      const binding = await workflowBindingStoreFor(ctx).getByProjectId(ledger.multicaProjectId);
      if (!binding) throw new Error(`Workflow binding not found for project: ${ledger.multicaProjectId}`);
      const manifest = await resolveManifestForLedger(ctx, ledger);
      const stageId = args.stageId ?? resolveNextStageId(manifest, ledger.currentStageId);
      if (!stageId) throw new Error(`No next stage available for workflow run: ${args.workflowRunId}`);
      const existing = ledger.stages[stageId];
      const stage = seedWorkflowStage(ledger, manifest, binding, {
        stageId,
        attempt: args.attempt ?? existing?.attempt ?? 1,
        issueId: args.issueId,
        assignedAgentId: args.assignedAgentId,
      });
      const updated = await mutateWorkflow(ctx, () => store.upsertStage(args.workflowRunId, toStageUpsertInput(stage)));
      return workflowRunResult("workflow_stage_seed", updated);
    },
  });

  pi.registerTool({
    name: "multica_workflow_stage_transition",
    label: "Multica Workflow Stage Transition",
    description: "Transition a seeded/produced workflow stage to the next status.",
    parameters: workflowStageTransitionParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { workflowRunId: string; stageId: string; status: WorkflowStageStatus };
      const store = workflowRunStoreFor(ctx);
      const ledger = await store.load(args.workflowRunId);
      if (!ledger) throw new Error(`Workflow run not found: ${args.workflowRunId}`);
      const stage = ledger.stages[args.stageId];
      if (!stage) throw new Error(`Workflow stage not found: ${args.stageId}`);
      const latestArtifact = [...ledger.artifacts]
        .reverse()
        .find((artifact) => artifact.stageId === args.stageId && artifact.attempt === stage.attempt);
      if (args.status === "accepted" && !canAcceptProducedStage(stage, latestArtifact)) {
        throw new Error(`Cannot accept stage without produced status and artifact: ${args.stageId}`);
      }
      const nextStage = transitionWorkflowStage(stage, args.status, latestArtifact);
      let updated = await mutateWorkflow(ctx, () => store.upsertStage(args.workflowRunId, toStageUpsertInput(nextStage)));
      if (args.status === "accepted") {
        const manifest = await resolveManifestForLedger(ctx, updated);
        if (!resolveNextStageId(manifest, args.stageId)) {
          updated = await mutateWorkflow(ctx, () => store.setWorkflowStatus(args.workflowRunId, "completed"));
        }
      }
      return workflowRunResult("workflow_stage_transition", updated);
    },
  });

  pi.registerTool({
    name: "multica_workflow_artifact_record",
    label: "Multica Workflow Artifact Record",
    description: "Record one workflow artifact envelope in the run ledger.",
    parameters: workflowArtifactRecordParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { workflowRunId: string; artifact: WorkflowArtifactEnvelope };
      const runStore = workflowRunStoreFor(ctx);
      const existingLedger = await runStore.load(args.workflowRunId);
      if (!existingLedger) throw new Error(`Workflow run not found: ${args.workflowRunId}`);
      const binding = await workflowBindingStoreFor(ctx).getByProjectId(existingLedger.multicaProjectId);
      if (!binding) throw new Error(`Workflow binding not found for project: ${existingLedger.multicaProjectId}`);
      if (!pathWithinArtifactRoot(args.artifact.outputPath, binding.artifactRoot)) {
        throw new Error(`Artifact output path must stay under binding artifactRoot ${binding.artifactRoot}: ${args.artifact.outputPath}`);
      }
      const ledger = await mutateWorkflow(ctx, () => runStore.recordArtifact(args.workflowRunId, args.artifact));
      return workflowRunResult("workflow_artifact_record", ledger);
    },
  });

  pi.registerTool({
    name: "multica_workflow_question_record",
    label: "Multica Workflow Question Record",
    description: "Record one Question Task answer artifact in the run ledger.",
    parameters: workflowQuestionRecordParameters,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const args = params as { workflowRunId: string; question: WorkflowQuestionRecord };
      const ledger = await mutateWorkflow(ctx, () => workflowRunStoreFor(ctx).recordQuestion(args.workflowRunId, args.question));
      return workflowRunResult("workflow_question_record", ledger);
    },
  });

  pi.registerTool({
    name: "multica_workflow_permission_check",
    label: "Multica Workflow Permission Check",
    description: "Compute effective permission as Adapter ∩ Project ∩ Stage ∩ Issue ∩ Agent capability.",
    parameters: workflowPermissionCheckParameters,
    async execute(_toolCallId, params) {
      const result = computeEffectivePermission(params as {
        adapterRequest: string[];
        projectGrant: string[];
        stageGrant: string[];
        issueBoundary: string[];
        agentCapability: string[];
      });
      return {
        content: [{ type: "text" as const, text: `granted: ${result.granted.join(", ") || "-"}\nblocked: ${result.blocked.join(", ") || "-"}` }],
        details: result,
      };
    },
  });
}
