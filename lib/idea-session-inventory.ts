import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { sha256Hex } from "./hash.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { IdeaInvocationReservationStore } from "./idea-entry-reservation.ts";
import { IdeaSessionManifestSchema } from "./idea-session-manifest.ts";
import { assertValid, validateSchema } from "./validation.ts";
import { hashWorkflowRunLedger, WorkflowRunStateStore } from "./workflow-run-state.ts";
import { HumanFinalReviewJournalSchema } from "./workflow-human-final-review-journal.ts";
import { deriveReviewJournalLifecycle } from "./workflow-human-final-review-journal.ts";

export interface IdeaSessionInventoryRecord { sessionId: string; invocationToken: string; canaryPath: string; workflowRunId?: string; parentIdentifier?: string; lifecycleStatus: string; stateUpdatedAt: string; manifestPresent: boolean; ledgerPresent: boolean; corrupt: boolean; corruptReason?: string; reviewJournalStatus?: string }
export interface IdeaSessionInventorySnapshot { schemaVersion: 1; generation: number; rebuiltAt: string; sessionsRoot: string; records: IdeaSessionInventoryRecord[] }
const inventoryPath = (sessionsRoot: string) => join(sessionsRoot, SPINE_STATE_ROOT, "idea-session-inventory.json");
async function loadManifest(canaryPath: string) { const raw = await readJsonFile<unknown>(join(canaryPath, SPINE_STATE_ROOT, "idea-session-manifest.json")); if (!raw) return undefined; try { return assertValid(validateSchema(IdeaSessionManifestSchema, raw), "Invalid manifest"); } catch { return undefined; } }
async function loadReviewJournal(canaryPath: string, workflowRunId: string) { const raw = await readJsonFile<unknown>(join(canaryPath, SPINE_STATE_ROOT, "review-journal", `${workflowRunId}.json`)); if (!raw) return undefined; try { return assertValid(validateSchema(HumanFinalReviewJournalSchema, raw), "Invalid review journal"); } catch { return undefined; } }
async function listCanaryPaths(sessionsRoot: string) { try { const entries = await readdir(sessionsRoot, { withFileTypes: true }); const paths: string[] = []; for (const entry of entries) { if (!entry.isDirectory()) continue; const candidate = join(sessionsRoot, entry.name); try { await stat(join(candidate, SPINE_STATE_ROOT, "idea-session-manifest.json")); paths.push(candidate); } catch { try { await stat(join(candidate, SPINE_STATE_ROOT, "workflow-runs")); paths.push(candidate); } catch {} } } return paths; } catch { return []; } }
export async function rebuildIdeaSessionInventory(sessionsRoot: string): Promise<IdeaSessionInventorySnapshot> {
  const reservationStore = new IdeaInvocationReservationStore(sessionsRoot); const records: IdeaSessionInventoryRecord[] = [];
  for (const canaryPath of await listCanaryPaths(sessionsRoot)) {
    const manifest = await loadManifest(canaryPath); let corrupt = false; let corruptReason: string | undefined; let workflowRunId = manifest?.workflowRunId; let lifecycleStatus: string = manifest?.lifecycleStatus ?? "active"; let parentIdentifier = manifest?.parentIdentifier; let sessionId = manifest?.sessionId ?? `legacy-${sha256Hex(canaryPath).slice(0, 8)}`; let invocationToken = manifest?.invocationToken ?? "legacy"; let stateUpdatedAt = manifest?.updatedAt ?? new Date(0).toISOString(); let ledgerPresent = false; let reviewJournalStatus: string | undefined;
    const runStore = new WorkflowRunStateStore(canaryPath); let ledger = workflowRunId ? await runStore.load(workflowRunId) : undefined;
    if (!ledger) { try { const files = (await readdir(join(canaryPath, SPINE_STATE_ROOT, "workflow-runs"))).filter((name) => name.endsWith(".json")); if (files.length === 1) { workflowRunId = files[0].replace(/\.json$/, ""); ledger = await runStore.load(workflowRunId); } } catch {} }
    ledgerPresent = Boolean(ledger);
    if (ledger) { const journal = await loadReviewJournal(canaryPath, ledger.workflowRunId); reviewJournalStatus = journal?.status; lifecycleStatus = deriveReviewJournalLifecycle(ledger, journal); stateUpdatedAt = ledger.updatedAt; try { hashWorkflowRunLedger(ledger); } catch (error) { corrupt = true; corruptReason = error instanceof Error ? error.message : String(error); } }
    else if (manifest?.workflowRunId) { corrupt = true; corruptReason = "Manifest references missing workflow run ledger"; }
    records.push({ sessionId, invocationToken, canaryPath, workflowRunId, parentIdentifier, lifecycleStatus, stateUpdatedAt, manifestPresent: Boolean(manifest), ledgerPresent, corrupt, corruptReason, reviewJournalStatus });
  }
  try { for (const file of (await readdir(join(sessionsRoot, SPINE_STATE_ROOT, "idea-invocations"))).filter((name) => name.endsWith(".json"))) { const token = file.replace(/\.json$/, ""); const reservation = await reservationStore.get(token); if (!reservation || records.some((record) => record.invocationToken === token)) continue; records.push({ sessionId: reservation.sessionId, invocationToken: token, canaryPath: reservation.canaryPath ?? "", workflowRunId: reservation.workflowRunId, parentIdentifier: reservation.parentIdentifier, lifecycleStatus: reservation.status === "completed" ? "active" : "starting", stateUpdatedAt: reservation.updatedAt, manifestPresent: false, ledgerPresent: false, corrupt: false }); } } catch {}
  records.sort((a, b) => a.stateUpdatedAt.localeCompare(b.stateUpdatedAt) || a.sessionId.localeCompare(b.sessionId));
  return { schemaVersion: 1, generation: Date.now(), rebuiltAt: new Date().toISOString(), sessionsRoot: resolve(sessionsRoot), records };
}
export class IdeaSessionInventoryStore { private readonly sessionsRoot: string; constructor(sessionsRoot: string) { this.sessionsRoot = sessionsRoot; } async load() { return readJsonFile<IdeaSessionInventorySnapshot>(inventoryPath(this.sessionsRoot)); } async rebuildAndSwap(expectedGeneration?: number) { const rebuilt = await rebuildIdeaSessionInventory(this.sessionsRoot); const path = inventoryPath(this.sessionsRoot); return withFileLock(path, async () => { const current = await this.load(); if (expectedGeneration !== undefined && current && current.generation !== expectedGeneration) { const merged = await rebuildIdeaSessionInventory(this.sessionsRoot); merged.generation = (current.generation ?? 0) + 1; await writeJsonAtomic(path, merged); return merged; } rebuilt.generation = (current?.generation ?? 0) + 1; await writeJsonAtomic(path, rebuilt); return rebuilt; }); } }
export async function readInventoryOrRebuild(sessionsRoot: string) { const store = new IdeaSessionInventoryStore(sessionsRoot); return (await store.load()) ?? store.rebuildAndSwap(); }
