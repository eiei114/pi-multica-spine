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
      revision: "ios-agent-app-template@acf82c9",
      sourceRepository: "https://github.com/eiei114/ios-agent-app-template",
      sourceCommit: "acf82c9a169050c06ed33b9514ac1e17b6ccb68c",
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
      revision: "astro-web-template@5db0d93",
      sourceRepository: "https://github.com/eiei114/astro-web-template",
      sourceCommit: "5db0d93e7acfd81a7e9f4a64a257d65501102684",
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
      revision: "tauri-windows-template@1a2b3c4",
      sourceRepository: "https://github.com/eiei114/tauri-windows-template",
      sourceCommit: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
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
