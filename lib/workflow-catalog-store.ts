import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { safeIssueIdentifier } from "./state-store.ts";
import {
  WorkflowCatalogEntrySchema,
  createWorkflowCatalogEntry,
  transitionWorkflowCatalogEntry,
  type WorkflowCatalogEntry,
  type WorkflowCatalogManifest,
  type WorkflowCatalogStatus,
} from "./workflow-catalog.ts";
import { SPINE_STATE_ROOT } from "./types.ts";
import { assertValid, validateSchema } from "./validation.ts";

export class WorkflowCatalogStore {
  readonly cwd: string;
  readonly root: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.root = join(cwd, SPINE_STATE_ROOT, "workflow-catalog");
  }

  entryPath(adapterId: string, adapterVersion: number): string {
    return join(this.root, safeIssueIdentifier(adapterId), `v${adapterVersion}.json`);
  }

  async get(adapterId: string, adapterVersion: number): Promise<WorkflowCatalogEntry | undefined> {
    const entry = await readJsonFile<WorkflowCatalogEntry>(this.entryPath(adapterId, adapterVersion));
    if (!entry) return undefined;
    return assertValid(validateSchema(WorkflowCatalogEntrySchema, entry), "Invalid workflow catalog entry");
  }

  async upsert(manifest: WorkflowCatalogManifest, status: WorkflowCatalogStatus = "quarantined"): Promise<WorkflowCatalogEntry> {
    if (status !== "quarantined") {
      throw new Error(`New workflow catalog entries must start quarantined; use transition after audit (received ${status})`);
    }
    const path = this.entryPath(manifest.adapterId, manifest.adapterVersion);
    return withFileLock(path, async () => {
      const candidate = createWorkflowCatalogEntry(manifest, status);
      const existing = await this.get(manifest.adapterId, manifest.adapterVersion);
      if (existing) {
        if (existing.status !== "quarantined") {
          throw new Error(`Cannot replace immutable ${existing.status} catalog entry: ${manifest.adapterId}@${manifest.adapterVersion}`);
        }
        if (existing.manifestDigest === candidate.manifestDigest) return existing;
        const entry: WorkflowCatalogEntry = {
          ...existing,
          manifest: candidate.manifest,
          manifestDigest: candidate.manifestDigest,
          status,
          updatedAt: new Date().toISOString(),
        };
        await writeJsonAtomic(path, entry);
        return entry;
      }
      await writeJsonAtomic(path, candidate);
      return candidate;
    });
  }

  async transition(adapterId: string, adapterVersion: number, status: WorkflowCatalogStatus): Promise<WorkflowCatalogEntry> {
    const path = this.entryPath(adapterId, adapterVersion);
    return withFileLock(path, async () => {
      const existing = await this.get(adapterId, adapterVersion);
      if (!existing) throw new Error(`Workflow catalog entry not found: ${adapterId}@${adapterVersion}`);
      const entry = transitionWorkflowCatalogEntry(existing, status);
      await writeJsonAtomic(path, entry);
      return entry;
    });
  }

  async list(): Promise<WorkflowCatalogEntry[]> {
    try {
      const adapterDirs = await readdir(this.root, { withFileTypes: true });
      const entries: WorkflowCatalogEntry[] = [];
      for (const adapterDir of adapterDirs) {
        if (!adapterDir.isDirectory()) continue;
        const versionFiles = await readdir(join(this.root, adapterDir.name), { withFileTypes: true });
        for (const versionFile of versionFiles) {
          if (!versionFile.isFile() || !versionFile.name.endsWith(".json")) continue;
          const entry = await readJsonFile<WorkflowCatalogEntry>(join(this.root, adapterDir.name, versionFile.name));
          if (entry) {
            entries.push(assertValid(validateSchema(WorkflowCatalogEntrySchema, entry), "Invalid workflow catalog entry"));
          }
        }
      }
      return entries.sort((left, right) => {
        if (left.manifest.adapterId === right.manifest.adapterId) {
          return right.manifest.adapterVersion - left.manifest.adapterVersion;
        }
        return left.manifest.adapterId.localeCompare(right.manifest.adapterId);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
