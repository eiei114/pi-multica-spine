export type KnownErrorKind = "missing" | "invalid" | "conflict" | "permission" | "network";

export type ClassifiedError = {
  kind: KnownErrorKind;
  exitCode: number;
  retryable: boolean;
  message: string;
};

type CodeCarrier = Error & { code?: unknown };

const ERROR_CODES = {
  missing: new Set(["ENOENT"]),
  conflict: new Set(["EEXIST", "ENOTEMPTY"]),
  permission: new Set(["EACCES", "EPERM"]),
  network: new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]),
} as const;

const ERROR_EXIT_CODES = {
  missing: 66,
  invalid: 65,
  conflict: 73,
  permission: 77,
  network: 75,
} as const satisfies Record<KnownErrorKind, number>;

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as CodeCarrier).code;
  return typeof code === "string" ? code : undefined;
}

function knownKindForCode(code: string | undefined): KnownErrorKind | undefined {
  if (!code) return undefined;
  for (const [kind, codes] of Object.entries(ERROR_CODES)) {
    if ((codes as ReadonlySet<string>).has(code)) return kind as KnownErrorKind;
  }
  return undefined;
}

function isInvalidError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError;
}

export function classifyErrorForCli(error: unknown): ClassifiedError {
  const kind = knownKindForCode(errorCode(error)) ?? (isInvalidError(error) ? "invalid" : undefined);
  if (!kind) throw error;

  const message = error instanceof Error && error.message ? error.message : kind;
  return {
    kind,
    exitCode: ERROR_EXIT_CODES[kind],
    retryable: kind === "network",
    message: `${kind}: ${message}`,
  };
}

export async function fallbackAfterCanonicalRecheck<T>(
  action: () => Promise<T>,
  readCanonical: () => Promise<T | undefined>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const classified = classifyErrorForCli(error);
    if (classified.kind !== "missing") throw error;
    const canonical = await readCanonical();
    if (canonical !== undefined) return canonical;
    return fallback();
  }
}
