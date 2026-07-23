import { createHash } from "node:crypto";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (typeof value === "object" && value) {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeJson(item)] as const);
    return Object.fromEntries(normalizedEntries);
  }
  return String(value);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function sha256Hex(value: unknown): string {
  const source = typeof value === "string" ? value : stableStringify(value);
  return createHash("sha256").update(source).digest("hex");
}
