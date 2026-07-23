export type NpmPublishFailureClass =
  | "benign_already_published"
  | "auth_failure"
  | "forbidden"
  | "not_found"
  | "unknown";

export interface ClassifyNpmPublishFailureInput {
  stderr: string;
  exitCode?: number;
  localShasum?: string;
  publishedShasum?: string;
}

export function extractNpmErrorCode(stderr: string): string | undefined {
  const match = stderr.match(/\bnpm error code ([A-Z0-9]+)\b/i);
  return match?.[1]?.toUpperCase();
}

export function isBenignAlreadyPublishedMessage(stderr: string): boolean {
  return /cannot publish over the previously published versions/i.test(stderr)
    || /previously published/i.test(stderr)
    || /You cannot publish over the previously published version/i.test(stderr);
}

export function classifyNpmPublishFailure(input: ClassifyNpmPublishFailureInput): NpmPublishFailureClass {
  const code = extractNpmErrorCode(input.stderr);
  if (code === "E404") return "not_found";
  if (code === "E401" || /ENEEDAUTH/i.test(input.stderr)) return "auth_failure";
  if (code === "E403") {
    if (isBenignAlreadyPublishedMessage(input.stderr)) {
      if (input.localShasum && input.publishedShasum && input.localShasum !== input.publishedShasum) {
        return "forbidden";
      }
      return "benign_already_published";
    }
    return "forbidden";
  }
  if (isBenignAlreadyPublishedMessage(input.stderr)) {
    if (input.localShasum && input.publishedShasum && input.localShasum !== input.publishedShasum) {
      return "forbidden";
    }
    return "benign_already_published";
  }
  return "unknown";
}

export function shouldTreatNpmPublishFailureAsSuccess(input: ClassifyNpmPublishFailureInput): boolean {
  return classifyNpmPublishFailure(input) === "benign_already_published";
}
