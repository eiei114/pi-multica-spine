export interface IdeaEntryHumanResultInput {
  ok: boolean;
  mode?: string;
  result?: string;
  next?: string;
  parentIdentifier?: string;
  workflowRunId?: string;
  sessionId?: string;
  invocationToken?: string;
  error?: string;
}

export function formatIdeaEntryHumanResult(input: IdeaEntryHumanResultInput): string {
  if (!input.ok) {
    return `RESULT: failed — ${input.error ?? "unknown error"}\nNext: /skill:idea-to-build`;
  }
  const result = input.result ?? (input.parentIdentifier
    ? `Sandbox idea session ${input.sessionId ?? "(pending)"} is ${input.mode ?? "active"} with parent ${input.parentIdentifier}`
    : `Sandbox idea session ${input.sessionId ?? "(planned)"} is ready for ${input.mode ?? "offline planning"}`);
  const next = input.next ?? (input.workflowRunId
    ? `/skill:idea-status --workflow-run-id ${input.workflowRunId}`
    : 'node scripts/workflow-idea-entry.mjs --rough-idea "<idea>" --execute');
  return `RESULT: ${result}\nNext: ${next}`;
}
