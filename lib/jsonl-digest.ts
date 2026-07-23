import { sha256Hex } from "./hash.ts";

export interface JsonlDigestResult {
  counts: Record<string, number>;
  lineCount: number;
  digest: string;
}

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  cyan: "\u001B[36m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
};

export function parseJsonlLines(content: string): string[] {
  return content.trim().split(/\n+/).filter(Boolean);
}

export function computeJsonlDigest(lines: readonly string[]): JsonlDigestResult {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const record = JSON.parse(line) as { status?: unknown };
    const status = String(record.status ?? "unknown");
    counts[status] = (counts[status] ?? 0) + 1;
  }
  const lineCount = lines.length;
  const sortedCounts = Object.fromEntries(Object.keys(counts).sort().map((key) => [key, counts[key]]));
  const payload = { counts: sortedCounts, lineCount };
  const digest = sha256Hex(payload);
  return { counts: sortedCounts, lineCount, digest };
}

export function formatJsonlDigestJson(result: JsonlDigestResult): string {
  return `${JSON.stringify(result)}\n`;
}

export function formatJsonlDigestHuman(
  result: JsonlDigestResult,
  options: { color?: boolean } = {},
): string {
  const color = options.color ?? false;
  const paint = (text: string, code: string) => (color ? `${code}${text}${ANSI.reset}` : text);
  const lines = [
    paint("JSONL digest summary", ANSI.bold),
    `${paint("lineCount", ANSI.cyan)}: ${result.lineCount}`,
    paint("counts:", ANSI.bold),
    ...Object.entries(result.counts).map(([status, count]) => `  ${paint(status, ANSI.green)}: ${count}`),
    `${paint("digest", ANSI.yellow)}: ${result.digest}`,
  ];
  return `${lines.join("\n")}\n`;
}

export function digestJsonlFileContent(content: string): JsonlDigestResult {
  return computeJsonlDigest(parseJsonlLines(content));
}

/** Stable JSONL digest helpers for canary and tooling. */