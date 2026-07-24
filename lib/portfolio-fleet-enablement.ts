import { join } from "node:path";
import { readJsonFile, withFileLock, writeJsonAtomic } from "./json-file-store.ts";
import { BUILD_TEMPLATE_CATALOG_ENTRIES, catalogDigest } from "./build-template-catalog.ts";
import { SPINE_STATE_ROOT } from "./types.ts";

export interface FleetPreflightCheck {
  id: string;
  status: "pass" | "fail";
  detail: string;
}

export interface FleetPreflightReport {
  schemaVersion: 1;
  generatedAt: string;
  checks: FleetPreflightCheck[];
  ok: boolean;
}

export interface PortfolioFleetConfig {
  schemaVersion: 1;
  enabled: boolean;
  preflightDigest?: string;
  enabledAt?: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function runFleetPreflight(fixtures: {
  iosWalkthrough: boolean;
  webWalkthrough: boolean;
  windowsWalkthrough: boolean;
  dailyRelicPilot: boolean;
  runtimeRoutesReady: boolean;
}): FleetPreflightReport {
  const checks: FleetPreflightCheck[] = [
    { id: "template_catalog_ios", status: BUILD_TEMPLATE_CATALOG_ENTRIES.some((e) => e.targetSurface === "ios") ? "pass" : "fail", detail: "SwiftUI iOS template registered" },
    { id: "template_catalog_web", status: BUILD_TEMPLATE_CATALOG_ENTRIES.some((e) => e.targetSurface === "web") ? "pass" : "fail", detail: "Astro Web template registered" },
    { id: "template_catalog_windows", status: BUILD_TEMPLATE_CATALOG_ENTRIES.some((e) => e.targetSurface === "windows") ? "pass" : "fail", detail: "Tauri Windows template registered" },
    { id: "fixture_ios_walkthrough", status: fixtures.iosWalkthrough ? "pass" : "fail", detail: "iOS fixture walkthrough" },
    { id: "fixture_web_walkthrough", status: fixtures.webWalkthrough ? "pass" : "fail", detail: "Web fixture walkthrough" },
    { id: "fixture_windows_walkthrough", status: fixtures.windowsWalkthrough ? "pass" : "fail", detail: "Windows fixture walkthrough" },
    { id: "daily_relic_supervised_pilot", status: fixtures.dailyRelicPilot ? "pass" : "fail", detail: "Daily Relic supervised pilot" },
    { id: "runtime_routes_ready", status: fixtures.runtimeRoutesReady ? "pass" : "fail", detail: "Surface runtime routes available" },
  ];
  return {
    schemaVersion: 1,
    generatedAt: nowIso(),
    checks,
    ok: checks.every((check) => check.status === "pass"),
  };
}

export class PortfolioFleetConfigStore {
  readonly path: string;

  constructor(cwd: string) {
    this.path = join(cwd, SPINE_STATE_ROOT, "portfolio-fleet.json");
  }

  async load(): Promise<PortfolioFleetConfig> {
    const existing = await readJsonFile<PortfolioFleetConfig>(this.path);
    if (existing) return existing;
    return { schemaVersion: 1, enabled: false, updatedAt: nowIso() };
  }

  async enable(report: FleetPreflightReport): Promise<PortfolioFleetConfig> {
    return withFileLock(this.path, async () => {
      if (!report.ok) {
        throw new Error("Fleet enablement refused: preflight failed");
      }
      const config: PortfolioFleetConfig = {
        schemaVersion: 1,
        enabled: true,
        preflightDigest: catalogDigest(),
        enabledAt: nowIso(),
        updatedAt: nowIso(),
      };
      await writeJsonAtomic(this.path, config);
      return config;
    });
  }

  async disable(): Promise<PortfolioFleetConfig> {
    return withFileLock(this.path, async () => {
      const config: PortfolioFleetConfig = { schemaVersion: 1, enabled: false, updatedAt: nowIso() };
      await writeJsonAtomic(this.path, config);
      return config;
    });
  }
}
