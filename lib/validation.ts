import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function validateSchema<Schema extends TSchema>(schema: Schema, input: unknown): ValidationResult<Static<Schema>> {
  if (Value.Check(schema, input)) {
    return { ok: true, value: input as Static<Schema> };
  }
  const errors = [...Value.Errors(schema, input)].map((error) => {
    const path = "path" in error && typeof error.path === "string" && error.path ? error.path : "/";
    return `${path}: ${error.message}`;
  });
  return { ok: false, errors };
}

export function assertValid<T>(result: ValidationResult<T>, label: string): T {
  if (!result.ok) {
    throw new Error(`${label}: ${result.errors.join("; ")}`);
  }
  return result.value;
}

export function uniqueValues(values: readonly string[], label: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(`${label}:${value}`);
    seen.add(value);
  }
  return [...duplicates];
}
