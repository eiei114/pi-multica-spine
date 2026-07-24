import { join } from "node:path";
import { sha256Hex } from "./hash.ts";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export type BuildTargetSurface = "ios" | "web" | "windows";

export interface BuildTemplateRuntimeContract {
  builderRole: string;
  runtimeId: string;
  resourceType: string;
  localRunCommand: string;
}

export interface BuildTemplateCatalogRevision {
  templateId: string;
  revision: string;
  sourceRepository: string;
  sourceCommit: string;
  approvedAt: string;
  ciStatus: "passed";
  docs: string[];
  checks: string[];
  runtimeContract: BuildTemplateRuntimeContract;
}

export interface BuildTemplateCatalogEntry {
  schemaVersion: 1;
  templateId: string;
  displayName: string;
  targetSurface: BuildTargetSurface;
  status: "approved";
  pinnedRevision: BuildTemplateCatalogRevision;
  updatedAt: string;
}

export const BUILD_TEMPLATE_CATALOG_ENTRIES: readonly BuildTemplateCatalogEntry[] = [
  {
    schemaVersion: 1,
    templateId: "ios-swiftui-agent-app",
    displayName: "SwiftUI iOS Agent App",
    targetSurface: "ios",
    status: "approved",
    pinnedRevision: {
      templateId: "ios-swiftui-agent-app",
      revision: "returnline-ios@d27a2c9",
      sourceRepository: "https://github.com/eiei114/returnline-ios",
      sourceCommit: "d27a2c9d5d04a7847bf9a6f8e3645e4b4bbfffbf",
      approvedAt: "2026-07-24T00:00:00.000Z",
      ciStatus: "passed",
      docs: ["README.md", "AGENTS.md"],
      checks: ["ci_build", "ci_test", "lint_format", "pr_workflow"],
      runtimeContract: {
        builderRole: "ios_cursor_builder",
        runtimeId: "cursor-macos",
        resourceType: "ios_repository",
        localRunCommand: "xcodebuild -scheme App -destination 'platform=iOS Simulator,name=iPhone 16' test",
      },
    },
    updatedAt: "2026-07-24T00:00:00.000Z",
  },
  {
    schemaVersion: 1,
    templateId: "astro-web-private",
    displayName: "Astro Web Private Scaffold",
    targetSurface: "web",
    status: "approved",
    pinnedRevision: {
      templateId: "astro-web-private",
      revision: "pi-extension-template@014b472",
      sourceRepository: "https://github.com/eiei114/pi-extension-template",
      sourceCommit: "014b472c4853d14ce716573f9410ce9cb3a5b90c",
      approvedAt: "2026-07-24T00:00:00.000Z",
      ciStatus: "passed",
      docs: ["README.md", "AGENTS.md"],
      checks: ["ci_build", "ci_test", "lint_format", "pr_workflow"],
      runtimeContract: {
        builderRole: "web_cursor_builder",
        runtimeId: "cursor-linux",
        resourceType: "web_repository",
        localRunCommand: "npm run build && npm test",
      },
    },
    updatedAt: "2026-07-24T00:00:00.000Z",
  },
  {
    schemaVersion: 1,
    templateId: "tauri-windows-react",
    displayName: "Tauri 2 + React Windows",
    targetSurface: "windows",
    status: "approved",
    pinnedRevision: {
      templateId: "tauri-windows-react",
      revision: "create-tauri-app@55a9932",
      sourceRepository: "https://github.com/tauri-apps/create-tauri-app",
      sourceCommit: "55a9932ffb1e1986382eeb1829e1b4483318dc95",
      approvedAt: "2026-07-24T00:00:00.000Z",
      ciStatus: "passed",
      docs: ["README.md", "AGENTS.md"],
      checks: ["ci_build", "ci_test", "lint_format", "pr_workflow"],
      runtimeContract: {
        builderRole: "windows_cursor_builder",
        runtimeId: "cursor-windows",
        resourceType: "windows_repository",
        localRunCommand: "npm run tauri build && npm test",
      },
    },
    updatedAt: "2026-07-24T00:00:00.000Z",
  },
];

export function getApprovedBuildTemplate(templateId: string): BuildTemplateCatalogEntry {
  const entry = BUILD_TEMPLATE_CATALOG_ENTRIES.find((item) => item.templateId === templateId);
  if (!entry || entry.status !== "approved") {
    throw new Error(`Build template is not approved: ${templateId}`);
  }
  return entry;
}

export function resolveBuildTemplateForSurface(
  targetSurface: BuildTargetSurface,
  templateId: string,
): BuildTemplateCatalogEntry {
  const entry = getApprovedBuildTemplate(templateId);
  if (entry.targetSurface !== targetSurface) {
    throw new Error(`Template ${templateId} does not match target surface ${targetSurface}`);
  }
  return entry;
}

export function catalogDigest(): string {
  return sha256Hex(BUILD_TEMPLATE_CATALOG_ENTRIES.map((entry) => ({
    templateId: entry.templateId,
    revision: entry.pinnedRevision.revision,
    sourceCommit: entry.pinnedRevision.sourceCommit,
  })));
}

export class BuildTemplateCatalogStore {
  readonly path: string;

  constructor(cwd: string) {
    this.path = join(cwd, SPINE_STATE_ROOT, "build-template-catalog.json");
  }

  async load(): Promise<{ schemaVersion: 1; digest: string; entries: BuildTemplateCatalogEntry[] }> {
    const existing = await readJsonFile<{ schemaVersion: 1; digest: string; entries: BuildTemplateCatalogEntry[] }>(this.path);
    if (existing) return existing;
    return { schemaVersion: 1, digest: catalogDigest(), entries: [...BUILD_TEMPLATE_CATALOG_ENTRIES] };
  }

  async sync(): Promise<{ schemaVersion: 1; digest: string; entries: BuildTemplateCatalogEntry[] }> {
    return withFileLock(this.path, async () => {
      const snapshot = { schemaVersion: 1 as const, digest: catalogDigest(), entries: [...BUILD_TEMPLATE_CATALOG_ENTRIES] };
      await writeJsonAtomic(this.path, snapshot);
      return snapshot;
    });
  }
}
