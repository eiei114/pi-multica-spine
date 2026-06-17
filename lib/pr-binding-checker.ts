import type { PrBinding } from "./types.ts";

export interface PrBindingCheck {
  ok: boolean;
  matchedFields: string[];
  missingMetadata: string[];
  recommendation: string;
}

const REQUIRED_PR_FIELDS = ["prUrl", "prNumber", "prHeadSha", "prBranch"] as const;

export function recommendedPrBodyLine(issueIdentifier: string): string {
  return `Multica Issue: ${issueIdentifier}`;
}

function collectStringFields(value: unknown, prefix: string, output: Array<{ field: string; value: string }>): void {
  if (typeof value === "string") {
    output.push({ field: prefix, value });
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    output.push({ field: prefix, value: String(value) });
    return;
  }
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringFields(item, `${prefix}[${index}]`, output));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectStringFields(child, prefix ? `${prefix}.${key}` : key, output);
  }
}

export function checkPrBinding(issueIdentifier: string, pr?: PrBinding): PrBindingCheck {
  const recommendation = recommendedPrBodyLine(issueIdentifier);
  if (!pr) {
    return {
      ok: false,
      matchedFields: [],
      missingMetadata: [...REQUIRED_PR_FIELDS],
      recommendation,
    };
  }

  const stringFields: Array<{ field: string; value: string }> = [];
  collectStringFields(
    {
      prUrl: pr.prUrl,
      prNumber: pr.prNumber,
      prHeadSha: pr.prHeadSha,
      prBranch: pr.prBranch,
      prTitle: pr.prTitle,
      prBody: pr.prBody,
      metadata: pr.metadata,
    },
    "",
    stringFields,
  );

  const matchedFields = stringFields
    .filter(({ value }) => value.includes(issueIdentifier))
    .map(({ field }) => field);

  const missingMetadata = REQUIRED_PR_FIELDS.filter((field) => pr[field] === undefined || pr[field] === "");

  return {
    ok: matchedFields.length > 0,
    matchedFields,
    missingMetadata,
    recommendation,
  };
}
