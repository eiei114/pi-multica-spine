import { join } from "node:path";
import { Type, type Static } from "typebox";
import { readJsonFile, writeJsonAtomic } from "./json-file-store.ts";
import { StringEnum } from "./schema.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";

export const IdeaSessionManifestSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  sessionId: Type.String({ minLength: 1 }),
  invocationToken: Type.String({ minLength: 1 }),
  normalizedInputHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  canaryPath: Type.String({ minLength: 1 }),
  workflowRunId: Type.Optional(Type.String({ minLength: 1 })),
  parentIdentifier: Type.Optional(Type.String({ minLength: 1 })),
  parentIssueId: Type.Optional(Type.String({ minLength: 1 })),
  vaultIdeaNotePath: Type.Optional(Type.String({ minLength: 1 })),
  reviewArtifactPath: Type.Optional(Type.String({ minLength: 1 })),
  closeoutEvidencePath: Type.Optional(Type.String({ minLength: 1 })),
  lifecycleStatus: StringEnum(["planned", "starting", "active", "blocked", "final_package", "reviewed", "retained", "starting_failed", "terminal_failed"]),
  createdAt: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 }),
});
export type IdeaSessionManifest = Static<typeof IdeaSessionManifestSchema>;

export class IdeaSessionManifestStore {
  private readonly canaryPath: string;
  constructor(canaryPath: string) { this.canaryPath = canaryPath; }
  manifestPath(): string { return join(this.canaryPath, SPINE_STATE_ROOT, "idea-session-manifest.json"); }
  async load(): Promise<IdeaSessionManifest | undefined> {
    const raw = await readJsonFile<unknown>(this.manifestPath());
    if (!raw) return undefined;
    return assertValid(validateSchema(IdeaSessionManifestSchema, raw), "Invalid idea session manifest");
  }
  async writeOnce(input: Omit<IdeaSessionManifest, "schemaVersion" | "createdAt" | "updatedAt"> & { now?: string }): Promise<IdeaSessionManifest> {
    const existing = await this.load();
    if (existing) {
      if (existing.sessionId !== input.sessionId || existing.invocationToken !== input.invocationToken) {
        throw new Error("Idea session manifest is immutable and already bound to a different session");
      }
      return existing;
    }
    const now = input.now ?? new Date().toISOString();
    const manifest: IdeaSessionManifest = { schemaVersion: 1, ...input, createdAt: now, updatedAt: now };
    await writeJsonAtomic(this.manifestPath(), manifest);
    return manifest;
  }
  async patch(patch: Partial<Pick<IdeaSessionManifest, "workflowRunId" | "parentIdentifier" | "parentIssueId" | "vaultIdeaNotePath" | "reviewArtifactPath" | "closeoutEvidencePath" | "lifecycleStatus">>, now?: string): Promise<IdeaSessionManifest> {
    const existing = await this.load();
    if (!existing) throw new Error("Idea session manifest not found");
    const updated = { ...existing, ...patch, updatedAt: now ?? new Date().toISOString() };
    await writeJsonAtomic(this.manifestPath(), updated);
    return updated;
  }
}
