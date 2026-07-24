import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export type PortfolioQueueEntryStatus =
  | "queued"
  | "admitted"
  | "active"
  | "released"
  | "skipped"
  | "blocked";

export interface PortfolioQueueEntry {
  sessionId: string;
  workflowRunId: string;
  projectTitle: string;
  promotionReadyAt: string;
  artifactBundleHash: string;
  status: PortfolioQueueEntryStatus;
  skipReason?: string;
  admittedAt?: string;
  releasedAt?: string;
}

export interface PortfolioQueueState {
  schemaVersion: 1;
  entries: PortfolioQueueEntry[];
  activeSessionId?: string;
  updatedAt: string;
}

export interface PortfolioCandidate {
  entry: PortfolioQueueEntry;
  selectionReason: "planned_reuse" | "fifo";
  plannedProjectId?: string;
}

export interface PortfolioSelectionInput {
  entries: readonly PortfolioQueueEntry[];
  activeSessionId?: string;
  plannedProjects: Array<{ id: string; title: string; status: string }>;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function isPortfolioSlotAvailable(state: Pick<PortfolioQueueState, "activeSessionId">): boolean {
  return !state.activeSessionId;
}

export function selectPortfolioCandidate(input: PortfolioSelectionInput): PortfolioCandidate | undefined {
  if (input.activeSessionId) return undefined;
  const queued = input.entries
    .filter((entry) => entry.status === "queued")
    .sort((left, right) => left.promotionReadyAt.localeCompare(right.promotionReadyAt));
  if (!queued.length) return undefined;

  for (const entry of queued) {
    const planned = input.plannedProjects.filter(
      (project) => project.title === entry.projectTitle && project.status === "planned",
    );
    if (planned.length === 1) {
      return { entry, selectionReason: "planned_reuse", plannedProjectId: planned[0].id };
    }
  }
  return { entry: queued[0], selectionReason: "fifo" };
}

export function resolvePortfolioAdmissionTarget(
  input: PortfolioSelectionInput & { sessionId: string },
): PortfolioCandidate | undefined {
  if (input.activeSessionId) {
    if (input.activeSessionId !== input.sessionId) return undefined;
    const entry = input.entries.find((item) => item.sessionId === input.sessionId);
    if (!entry || entry.status === "skipped" || entry.status === "released") return undefined;
    return { entry, selectionReason: "fifo" };
  }
  return selectPortfolioCandidate(input);
}

export function previewPortfolioCandidate(
  state: PortfolioQueueState,
  input: {
    sessionId: string;
    workflowRunId: string;
    projectTitle: string;
    artifactBundleHash: string;
    promotionReadyAt?: string;
  },
  plannedProjects: PortfolioSelectionInput["plannedProjects"],
): PortfolioCandidate | undefined {
  const hasEntry = state.entries.some((entry) => entry.sessionId === input.sessionId);
  const entries = hasEntry
    ? state.entries
    : [
        ...state.entries,
        {
          sessionId: input.sessionId,
          workflowRunId: input.workflowRunId,
          projectTitle: input.projectTitle,
          promotionReadyAt: input.promotionReadyAt ?? nowIso(),
          artifactBundleHash: input.artifactBundleHash,
          status: "queued" as const,
        },
      ];
  return resolvePortfolioAdmissionTarget({
    entries,
    activeSessionId: state.activeSessionId,
    sessionId: input.sessionId,
    plannedProjects,
  });
}

export class PortfolioQueueStore {
  readonly path: string;

  constructor(cwd: string) {
    this.path = join(cwd, SPINE_STATE_ROOT, "portfolio-queue.json");
  }

  async load(): Promise<PortfolioQueueState> {
    const existing = await readJsonFile<PortfolioQueueState>(this.path);
    if (existing) return existing;
    return { schemaVersion: 1, entries: [], updatedAt: nowIso() };
  }

  async enqueue(input: Omit<PortfolioQueueEntry, "status" | "promotionReadyAt"> & { promotionReadyAt?: string }): Promise<PortfolioQueueState> {
    return withFileLock(this.path, async () => {
      const state = await this.load();
      const duplicate = state.entries.find((entry) => entry.sessionId === input.sessionId);
      if (duplicate) {
        if (duplicate.artifactBundleHash !== input.artifactBundleHash) {
          throw new Error("Portfolio queue artifact bundle hash conflict for session");
        }
        return state;
      }
      const entry: PortfolioQueueEntry = {
        sessionId: input.sessionId,
        workflowRunId: input.workflowRunId,
        projectTitle: input.projectTitle,
        promotionReadyAt: input.promotionReadyAt ?? nowIso(),
        artifactBundleHash: input.artifactBundleHash,
        status: "queued",
      };
      const next: PortfolioQueueState = {
        ...state,
        entries: [...state.entries, entry],
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }

  async admit(sessionId: string): Promise<PortfolioQueueState> {
    return withFileLock(this.path, async () => {
      const state = await this.load();
      if (!state.entries.some((entry) => entry.sessionId === sessionId)) {
        throw new Error(`Cannot admit unknown portfolio queue session: ${sessionId}`);
      }
      if (state.activeSessionId && state.activeSessionId !== sessionId) {
        throw new Error("Portfolio queue global-1 fencing blocks concurrent admission");
      }
      const entries = state.entries.map((entry) => {
        if (entry.sessionId !== sessionId) return entry;
        return { ...entry, status: "admitted" as const, admittedAt: nowIso() };
      });
      const next: PortfolioQueueState = {
        ...state,
        entries,
        activeSessionId: sessionId,
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }

  async activate(sessionId: string): Promise<PortfolioQueueState> {
    return withFileLock(this.path, async () => {
      const state = await this.load();
      if (!state.entries.some((entry) => entry.sessionId === sessionId)) {
        throw new Error(`Cannot activate unknown portfolio queue session: ${sessionId}`);
      }
      const entries = state.entries.map((entry) => {
        if (entry.sessionId !== sessionId) return entry;
        return { ...entry, status: "active" as const };
      });
      const next: PortfolioQueueState = { ...state, entries, activeSessionId: sessionId, updatedAt: nowIso() };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }

  async skip(sessionId: string, reason: string): Promise<PortfolioQueueState> {
    return withFileLock(this.path, async () => {
      const state = await this.load();
      const entries = state.entries.map((entry) => {
        if (entry.sessionId !== sessionId) return entry;
        return { ...entry, status: "skipped" as const, skipReason: reason };
      });
      const next: PortfolioQueueState = {
        ...state,
        entries,
        activeSessionId: state.activeSessionId === sessionId ? undefined : state.activeSessionId,
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }

  async release(sessionId: string): Promise<PortfolioQueueState> {
    return withFileLock(this.path, async () => {
      const state = await this.load();
      const entries = state.entries.map((entry) => {
        if (entry.sessionId !== sessionId) return entry;
        return { ...entry, status: "released" as const, releasedAt: nowIso() };
      });
      const next: PortfolioQueueState = {
        ...state,
        entries,
        activeSessionId: state.activeSessionId === sessionId ? undefined : state.activeSessionId,
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, next);
      return next;
    });
  }
}

export interface PortfolioAdmissionPlan {
  candidate: PortfolioCandidate;
  mutations: string[];
}

export function buildPortfolioAdmissionPlan(candidate: PortfolioCandidate): PortfolioAdmissionPlan {
  return {
    candidate,
    mutations: [
      "resolve_project",
      "persist_binding",
      "create_parent_issue",
      "create_workflow_run",
      "import_artifact_envelopes",
      "write_parent_summary",
      "seed_spec_review",
      "activate_project",
    ],
  };
}
