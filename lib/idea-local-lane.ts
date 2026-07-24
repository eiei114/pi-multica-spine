import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export const LOCAL_IDEA_STAGE_IDS = [
  "capture",
  "question_resolution",
  "design_doc",
  "implementation_spec",
  "build_handoff",
] as const;

export type LocalIdeaStageId = (typeof LOCAL_IDEA_STAGE_IDS)[number];

export interface IdeaLocalLaneState {
  schemaVersion: 1;
  sessionId: string;
  workflowRunId: string;
  roughIdea: string;
  currentStageId: LocalIdeaStageId;
  status: "waiting" | "promotion_ready" | "promoted";
  implementationProjectId?: string;
  implementationProjectTitle?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIdeaLocalLaneInput {
  sessionId: string;
  workflowRunId: string;
  roughIdea: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createIdeaLocalLane(input: CreateIdeaLocalLaneInput): IdeaLocalLaneState {
  const timestamp = nowIso();
  return {
    schemaVersion: 1,
    sessionId: input.sessionId,
    workflowRunId: input.workflowRunId,
    roughIdea: input.roughIdea,
    currentStageId: "capture",
    status: "waiting",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class IdeaLocalLaneStore {
  readonly path: string;

  constructor(cwd: string) {
    this.path = join(cwd, SPINE_STATE_ROOT, "idea-local-lane.json");
  }

  async load(): Promise<IdeaLocalLaneState | undefined> {
    return readJsonFile<IdeaLocalLaneState>(this.path);
  }

  async create(input: CreateIdeaLocalLaneInput): Promise<IdeaLocalLaneState> {
    return withFileLock(this.path, async () => {
      const existing = await this.load();
      if (existing) {
        if (existing.sessionId !== input.sessionId || existing.workflowRunId !== input.workflowRunId) {
          throw new Error("Local idea lane is already bound to a different session");
        }
        return existing;
      }
      const state = createIdeaLocalLane(input);
      await writeJsonAtomic(this.path, state);
      return state;
    });
  }

  static advance(state: IdeaLocalLaneState): IdeaLocalLaneState {
    if (state.status === "promotion_ready" || state.status === "promoted") return state;
    const currentIndex = LOCAL_IDEA_STAGE_IDS.indexOf(state.currentStageId);
    if (currentIndex < 0) throw new Error(`Unknown local idea stage: ${state.currentStageId}`);
    if (currentIndex === LOCAL_IDEA_STAGE_IDS.length - 1) {
      return { ...state, status: "promotion_ready", updatedAt: nowIso() };
    }
    return {
      ...state,
      currentStageId: LOCAL_IDEA_STAGE_IDS[currentIndex + 1],
      updatedAt: nowIso(),
    };
  }

  async advance(): Promise<IdeaLocalLaneState> {
    return withFileLock(this.path, async () => {
      const state = await this.load();
      if (!state) throw new Error("Local idea lane not found");
      const advanced = IdeaLocalLaneStore.advance(state);
      await writeJsonAtomic(this.path, advanced);
      return advanced;
    });
  }

  async advanceToPromotionReady(): Promise<IdeaLocalLaneState> {
    let state = await this.load();
    if (!state) throw new Error("Local idea lane not found");
    while (state.status === "waiting") state = await this.advance();
    return state;
  }

  static bindImplementationProject(
    state: IdeaLocalLaneState,
    project: { id: string; title: string },
  ): IdeaLocalLaneState {
    if (state.status !== "promotion_ready" || state.currentStageId !== "build_handoff") {
      throw new Error("Implementation Project binding requires a promotion-ready build_handoff");
    }
    return {
      ...state,
      status: "promoted",
      implementationProjectId: project.id,
      implementationProjectTitle: project.title,
      updatedAt: nowIso(),
    };
  }

  async bindImplementationProject(project: { id: string; title: string }): Promise<IdeaLocalLaneState> {
    return withFileLock(this.path, async () => {
      const state = await this.load();
      if (!state) throw new Error("Local idea lane not found");
      const promoted = IdeaLocalLaneStore.bindImplementationProject(state, project);
      await writeJsonAtomic(this.path, promoted);
      return promoted;
    });
  }
}
