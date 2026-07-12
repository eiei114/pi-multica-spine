import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import { Type } from "typebox";
import { StringEnum } from "../lib/schema.ts";
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

function storeFor(ctx: ExtensionContext): SpineStateStore {
  return new SpineStateStore(ctx.cwd);
}

async function mutateSpine<T>(ctx: ExtensionContext, fn: () => Promise<T>): Promise<T> {
  return withFileMutationQueue(resolve(ctx.cwd, ".multica-spine", "current.json"), fn);
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
}
