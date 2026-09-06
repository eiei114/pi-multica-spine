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

/**
 * Extract top-level status without full JSON.parse when the line shape allows it.
 *
 * A strict single-pass structural scan validates the whole line first, so the
 * fast path keeps exact JSON.parse semantics: only top-level keys count, the
 * LAST duplicate wins, trailing garbage rejects the line, and values coerce
 * exactly like the fallback (exponents, literals, nested values). Anything
 * malformed (bad escapes, unbalanced brackets, missing colons, bad numbers)
 * falls back to JSON.parse, which then yields "unknown".
 */
export function extractJsonlRecordStatus(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return parseJsonlStatusFallback(line);
  }

  let lastValueStart = -1;
  let lastValueEnd = -1;

  const isWs = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";
  const skipWs = (n: number): number => {
    while (n < trimmed.length && isWs(trimmed[n])) n++;
    return n;
  };

  // Strict JSON string scan from the opening quote. Returns the index just
  // past the closing quote, or -1 on invalid escapes, raw controls, or EOF.
  const scanString = (start: number): number => {
    let j = start + 1;
    while (j < trimmed.length) {
      const c = trimmed[j];
      if (c === '"') return j + 1;
      if (c === "\\") {
        const e = trimmed[j + 1];
        if (e === '"' || e === "\\" || e === "/" || e === "b" || e === "f" || e === "n" || e === "r" || e === "t") {
          j += 2;
          continue;
        }
        if (e === "u" && /^[0-9a-fA-F]{4}$/.test(trimmed.slice(j + 2, j + 6))) {
          j += 6;
          continue;
        }
        return -1;
      }
      if (c < " ") return -1;
      j++;
    }
    return -1;
  };

  const scanLiteral = (start: number): number => {
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(trimmed.slice(start));
    return m ? start + m[0].length : -1;
  };

  const scanValue = (start: number, depth: number): number => {
    const j = skipWs(start);
    if (j >= trimmed.length) return -1;
    const c = trimmed[j];
    if (c === '"') return scanString(j);
    if (c === "{") return scanObject(j, depth + 1);
    if (c === "[") return scanArray(j, depth + 1);
    if (c === "-" || (c >= "0" && c <= "9") || c === "t" || c === "f" || c === "n") return scanLiteral(j);
    return -1;
  };

  const scanObject = (start: number, depth: number): number => {
    let j = skipWs(start + 1);
    if (trimmed[j] === "}") return j + 1;
    for (;;) {
      if (trimmed[j] !== '"') return -1;
      const keyEnd = scanString(j);
      if (keyEnd === -1) return -1;
      const isStatusKey = depth === 1 && trimmed.slice(j, keyEnd) === '"status"';
      j = skipWs(keyEnd);
      if (trimmed[j] !== ":") return -1;
      const valueStart = skipWs(j + 1);
      const valueEnd = scanValue(valueStart, depth);
      if (valueEnd === -1) return -1;
      if (isStatusKey) {
        lastValueStart = valueStart;
        lastValueEnd = valueEnd;
      }
      j = skipWs(valueEnd);
      if (trimmed[j] === ",") {
        j = skipWs(j + 1);
        continue;
      }
      if (trimmed[j] === "}") return j + 1;
      return -1;
    }
  };

  const scanArray = (start: number, depth: number): number => {
    let j = skipWs(start + 1);
    if (trimmed[j] === "]") return j + 1;
    for (;;) {
      const valueEnd = scanValue(j, depth);
      if (valueEnd === -1) return -1;
      j = skipWs(valueEnd);
      if (trimmed[j] === ",") {
        j = skipWs(j + 1);
        continue;
      }
      if (trimmed[j] === "]") return j + 1;
      return -1;
    }
  };

  try {
    const rootEnd = scanObject(0, 1);
    if (rootEnd === -1 || skipWs(rootEnd) !== trimmed.length || lastValueStart === -1) {
      return parseJsonlStatusFallback(line);
    }
    return String(JSON.parse(trimmed.slice(lastValueStart, lastValueEnd)));
  } catch {
    return parseJsonlStatusFallback(line);
  }
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