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

const CONTRACT = `You are acting as a Multica Work Agent.

For Multica implementation or PR-producing work:
1. Bind the active issue identifier with multica_spine_bind.
2. Use multica_spine_next to see the required next action.
3. Ensure PRs reference the bound issue identifier.
4. Do not report done until multica_spine_verify passes.`;

const bindParameters = Type.Object({
  issueIdentifier: Type.String({ description: "Opaque Multica issue identifier. Do not assume DOT format." }),
  issueUrl: Type.Optional(Type.String({ description: "Optional source issue URL." })),
  issueTitle: Type.Optional(Type.String({ description: "Optional source issue title." })),
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

export default function multicaSpineExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("multica-spine", "Multica spine ready");
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
}
