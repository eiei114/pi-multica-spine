import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Hex } from "./hash.ts";

export interface FleetEvidenceRecord {
  id: "ios_walkthrough" | "web_walkthrough" | "windows_walkthrough" | "daily_relic_pilot" | "runtime_routes";
  artifactPath: string;
  artifactHash: string;
}

export interface FleetEvidenceBundle {
  schemaVersion: 1;
  records: FleetEvidenceRecord[];
}

export interface VerifiedFleetEvidence {
  iosWalkthrough: boolean;
  webWalkthrough: boolean;
  windowsWalkthrough: boolean;
  dailyRelicPilot: boolean;
  runtimeRoutesReady: boolean;
}

const REQUIRED_IDS: FleetEvidenceRecord["id"][] = [
  "ios_walkthrough",
  "web_walkthrough",
  "windows_walkthrough",
  "daily_relic_pilot",
  "runtime_routes",
];

export async function verifyFleetEvidence(bundle: FleetEvidenceBundle, cwd: string): Promise<VerifiedFleetEvidence> {
  if (bundle.schemaVersion !== 1) throw new Error("Unsupported fleet evidence schema version");
  const byId = new Map(bundle.records.map((record) => [record.id, record]));
  for (const id of REQUIRED_IDS) {
    const record = byId.get(id);
    if (!record?.artifactPath || !/^[a-f0-9]{64}$/i.test(record.artifactHash)) {
      throw new Error(`Missing verifiable fleet evidence: ${id}`);
    }
    const content = await readFile(resolve(cwd, record.artifactPath), "utf8");
    if (sha256Hex(content) !== record.artifactHash) {
      throw new Error(`Fleet evidence hash mismatch: ${id}`);
    }
  }
  return {
    iosWalkthrough: true,
    webWalkthrough: true,
    windowsWalkthrough: true,
    dailyRelicPilot: true,
    runtimeRoutesReady: true,
  };
}
