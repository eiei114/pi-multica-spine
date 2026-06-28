export const SPINE_STATE_ROOT = ".multica-spine";

export type EvidenceKind = "command" | "manual" | "test" | "lint" | "typecheck";

export interface IssueBinding {
  identifier: string;
  url?: string;
  title?: string;
  boundAt: string;
}

export interface PrBinding {
  prUrl: string;
  prNumber?: number;
  prHeadSha?: string;
  prBranch?: string;
  prTitle?: string;
  prBody?: string;
  metadata?: Record<string, unknown>;
  writebackRecorded?: boolean;
  linkedAt: string;
}

export interface EvidenceRecord {
  kind: EvidenceKind;
  command?: string;
  exitCode?: number;
  summary: string;
  outputExcerpt?: string;
  timestamp: string;
}

export interface HandoffRecord {
  done: string[];
  changed: string[];
  verification: string[];
  blockers?: string[];
  next?: string[];
  risks?: string[];
  timestamp: string;
}

export interface SpineTaskState {
  issue: IssueBinding;
  pr?: PrBinding;
  evidence: EvidenceRecord[];
  handoff?: HandoffRecord;
  verifiedAt?: string;
  updatedAt: string;
}

export interface CurrentBinding {
  issueIdentifier: string;
  taskFile: string;
  updatedAt: string;
}

export type SpineStatus =
  | "UNBOUND"
  | "BOUND"
  | "PR_LINKED"
  | "EVIDENCE_READY"
  | "HANDOFF_READY"
  | "VERIFIED";

export interface NextAction {
  tool: string;
  instruction: string;
}

export interface SpineEvaluation {
  status: SpineStatus;
  verified: boolean;
  missing: string[];
  nextAction: NextAction;
  prRecommendation?: string;
  gitCompletion?: {
    checked: boolean;
    blockers: string[];
    nextAction?: string;
    branchStatus?: string;
    headSha?: string;
  };
}

export interface SpineContextSnapshot {
  root: string;
  current?: CurrentBinding;
  task?: SpineTaskState;
  evaluation: SpineEvaluation;
}
