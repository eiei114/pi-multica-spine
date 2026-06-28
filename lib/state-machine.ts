import { checkPrBinding } from "./pr-binding-checker.ts";
import type { NextAction, SpineEvaluation, SpineStatus, SpineTaskState } from "./types.ts";
import type { GitCompletionCheck } from "./git-completion-checker.ts";

const ACTIONS = {
  bind: {
    tool: "multica_spine_bind",
    instruction: "Bind the active Multica issue identifier.",
  },
  linkPr: {
    tool: "multica_spine_link_pr",
    instruction: "Link the PR URL and metadata. Include pr_number, pr_head_sha, pr_branch, and writebackRecorded=true after source issue metadata is updated or manually recorded.",
  },
  addEvidence: {
    tool: "multica_spine_add_evidence",
    instruction: "Record at least one verification command or manual check with outcome.",
  },
  handoff: {
    tool: "multica_spine_handoff",
    instruction: "Write a structured handoff with done, changed, verification, blockers/risks, and next steps.",
  },
  verify: {
    tool: "multica_spine_verify",
    instruction: "Run the completion check before reporting done.",
  },
  fixGit: {
    tool: "git",
    instruction: "Finish git cleanup/push. If rebase rewrote history and CI passed, run `git push --force-with-lease` without asking the user.",
  },
  done: {
    tool: "none",
    instruction: "Spine verified. You may report done and hand off the PR.",
  },
} satisfies Record<string, NextAction>;

function computeStatus(task?: SpineTaskState, missing: string[] = []): SpineStatus {
  if (!task) return "UNBOUND";
  if (missing.length === 0 && task.verifiedAt) return "VERIFIED";
  if (task.handoff) return "HANDOFF_READY";
  if (task.evidence.length > 0) return "EVIDENCE_READY";
  if (task.pr) return "PR_LINKED";
  return "BOUND";
}

function nextActionForMissing(missing: string[]): NextAction {
  if (missing.some((item) => item.startsWith("git:"))) return ACTIONS.fixGit;
  if (missing.includes("active issue identifier")) return ACTIONS.bind;
  if (
    missing.includes("PR URL") ||
    missing.includes("PR metadata: prNumber") ||
    missing.includes("PR metadata: prHeadSha") ||
    missing.includes("PR metadata: prBranch") ||
    missing.includes("PR issue reference") ||
    missing.includes("PR binding writeback")
  ) {
    return ACTIONS.linkPr;
  }
  if (missing.includes("verification evidence")) return ACTIONS.addEvidence;
  if (missing.includes("handoff")) return ACTIONS.handoff;
  return ACTIONS.verify;
}

export function evaluateSpine(task?: SpineTaskState, gitCompletion?: GitCompletionCheck): SpineEvaluation {
  if (!task) {
    return {
      status: "UNBOUND",
      verified: false,
      missing: ["active issue identifier"],
      nextAction: ACTIONS.bind,
    };
  }

  const missing: string[] = [];
  const issueIdentifier = task.issue.identifier;
  if (!issueIdentifier.trim()) missing.push("active issue identifier");

  const prCheck = checkPrBinding(issueIdentifier, task.pr);
  if (!task.pr?.prUrl) missing.push("PR URL");
  for (const field of prCheck.missingMetadata) {
    if (field !== "prUrl") missing.push(`PR metadata: ${field}`);
  }
  if (!prCheck.ok) missing.push("PR issue reference");
  if (!task.pr?.writebackRecorded) missing.push("PR binding writeback");

  if (task.evidence.length === 0) missing.push("verification evidence");
  if (!task.handoff) {
    missing.push("handoff");
  } else {
    const handoffText = JSON.stringify(task.handoff);
    if (!handoffText.includes(issueIdentifier)) missing.push("handoff issue identifier");
    if (task.pr?.prUrl && !handoffText.includes(task.pr.prUrl)) missing.push("handoff PR URL");
  }

  if (gitCompletion?.blockers.length) missing.push(...gitCompletion.blockers);

  const verified = missing.length === 0 && Boolean(task.verifiedAt);
  return {
    status: computeStatus(task, missing),
    verified,
    missing,
    nextAction: verified
      ? ACTIONS.done
      : gitCompletion?.nextAction
        ? { tool: "git", instruction: gitCompletion.nextAction }
        : nextActionForMissing(missing),
    prRecommendation: prCheck.recommendation,
    gitCompletion,
  };
}
