import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { sha256Hex } from "./hash.ts";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { StringEnum } from "./schema.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";
import { IdeaInvocationStatusSchema } from "./idea-entry-config.ts";

export const IdeaInvocationReservationSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  invocationToken: Type.String({ minLength: 1 }),
  normalizedInputHash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  normalizedInput: Type.String({ minLength: 1 }),
  status: IdeaInvocationStatusSchema,
  sessionId: Type.String({ minLength: 1 }),
  canaryPath: Type.Optional(Type.String({ minLength: 1 })),
  workflowRunId: Type.Optional(Type.String({ minLength: 1 })),
  parentIdentifier: Type.Optional(Type.String({ minLength: 1 })),
  resultPointer: Type.Optional(Type.String({ minLength: 1 })),
  error: Type.Optional(Type.String({ minLength: 1 })),
  createdAt: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 }),
});
export type IdeaInvocationReservation = Static<typeof IdeaInvocationReservationSchema>;

export function normalizeRoughIdea(input: string): string {
  return input.replace(/\r\n/g, "\n").trim().replace(/\s+/g, " ");
}
export function hashNormalizedInput(input: string): string {
  return sha256Hex(normalizeRoughIdea(input));
}
export function buildSessionIdFromToken(token: string): string {
  return `idea-${token.slice(0, 8)}`;
}

export class IdeaInvocationReservationStore {
  private readonly rootDir: string;
  constructor(rootDir: string) { this.rootDir = rootDir; }
  private reservationPath(token: string): string {
    return join(this.rootDir, SPINE_STATE_ROOT, "idea-invocations", `${token}.json`);
  }
  async get(token: string): Promise<IdeaInvocationReservation | undefined> {
    const raw = await readJsonFile<unknown>(this.reservationPath(token));
    if (!raw) return undefined;
    return assertValid(validateSchema(IdeaInvocationReservationSchema, raw), "Invalid invocation reservation");
  }
  async reserve(input: { invocationToken?: string; normalizedInput: string; now?: () => string }): Promise<IdeaInvocationReservation> {
    const token = input.invocationToken ?? randomUUID();
    const now = input.now?.() ?? new Date().toISOString();
    const normalizedInput = normalizeRoughIdea(input.normalizedInput);
    const normalizedInputHash = hashNormalizedInput(normalizedInput);
    const path = this.reservationPath(token);
    return withFileLock(path, async () => {
      const existing = await this.get(token);
      if (existing) {
        if (existing.normalizedInputHash !== normalizedInputHash) {
          throw new Error(`Invocation token ${token} already reserved with different input. Use --new-session for a deliberate rerun.`);
        }
        return existing;
      }
      const reservation: IdeaInvocationReservation = {
        schemaVersion: 1,
        invocationToken: token,
        normalizedInputHash,
        normalizedInput,
        status: "reserved",
        sessionId: buildSessionIdFromToken(token),
        createdAt: now,
        updatedAt: now,
      };
      await writeJsonAtomic(path, reservation);
      return reservation;
    });
  }
  async update(token: string, patch: Partial<Pick<IdeaInvocationReservation, "status" | "canaryPath" | "workflowRunId" | "parentIdentifier" | "resultPointer" | "error">>, now?: () => string): Promise<IdeaInvocationReservation> {
    const path = this.reservationPath(token);
    return withFileLock(path, async () => {
      const existing = await this.get(token);
      if (!existing) throw new Error(`Invocation reservation not found: ${token}`);
      const updated = { ...existing, ...patch, updatedAt: now?.() ?? new Date().toISOString() };
      await writeJsonAtomic(path, updated);
      return updated;
    });
  }
}
