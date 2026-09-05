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

function parseJsonlStatusFallback(line: string): string {
  try {
    const record = JSON.parse(line) as { status?: unknown };
    return String(record.status ?? "unknown");
  } catch {
    return "unknown";
  }
}

/** Extract top-level status without full JSON.parse when the line shape allows it. */
export function extractJsonlRecordStatus(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return parseJsonlStatusFallback(line);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      if (depth === 1 && trimmed.startsWith('"status"', i)) {
        i += '"status"'.length;
        while (i < trimmed.length && (trimmed[i] === " " || trimmed[i] === "\t")) {
          i++;
        }
        if (trimmed[i] !== ":") {
          return parseJsonlStatusFallback(line);
        }
        i++;
        while (i < trimmed.length && (trimmed[i] === " " || trimmed[i] === "\t")) {
          i++;
        }
        if (trimmed[i] === '"') {
          const valueStart = i;
          i++;
          while (i < trimmed.length) {
            if (trimmed[i] === "\\") {
              i += 2;
              continue;
            }
            if (trimmed[i] === '"') {
              return JSON.parse(trimmed.slice(valueStart, i + 1)) as string;
            }
            i++;
          }
          return parseJsonlStatusFallback(line);
        }
        const literalStart = i;
        while (i < trimmed.length && !",}".includes(trimmed[i])) {
          i++;
        }
        const literal = trimmed.slice(literalStart, i).trim();
        return literal === "null" ? "null" : literal;
      }
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
    }
  }

  return parseJsonlStatusFallback(line);
}

export function computeJsonlDigest(lines: readonly string[]): JsonlDigestResult {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const status = extractJsonlRecordStatus(line);
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