import { StringEnum } from "./schema.ts";
import { validateSchema } from "./validation.ts";

export const VAULT_IDEA_NOTE_SCHEMA_VERSION = 1;
export const VaultIdeaNoteStatusSchema = StringEnum(["planned", "starting", "active", "blocked", "final_package", "reviewed", "terminal_failed"]);
export type VaultIdeaNoteStatus = import("typebox").Static<typeof VaultIdeaNoteStatusSchema>;
const FRONTMATTER_KEY_RE = /^([a-z_][a-z0-9_]*):\s*(.*)$/i;

export function parseVaultIdeaNoteFrontmatter(markdown: string): Record<string, unknown> | { error: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { error: "Vault idea note missing YAML frontmatter" };
  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const keyMatch = line.match(FRONTMATTER_KEY_RE);
    if (!keyMatch) continue;
    values[keyMatch[1]] = keyMatch[2].trim();
  }
  const schemaVersion = Number(values.idea_note_schema_version);
  if (!Number.isInteger(schemaVersion)) return { error: "Vault idea note missing idea_note_schema_version" };
  if (schemaVersion !== VAULT_IDEA_NOTE_SCHEMA_VERSION) return { error: `Unsupported vault idea note schema version: ${schemaVersion}` };
  const statusValidation = validateSchema(VaultIdeaNoteStatusSchema, values.status);
  if (!statusValidation.ok) return { error: `Invalid vault idea note status: ${values.status ?? "(missing)"}` };
  if (values.ready_for_multica !== "true" && values.ready_for_multica !== "false") return { error: "Vault idea note ready_for_multica must be true or false" };
  if (values.workflow_lane !== "idea-to-build") return { error: `Unsupported workflow_lane: ${values.workflow_lane ?? "(missing)"}` };
  return { idea_note_schema_version: schemaVersion, workflow_lane: "idea-to-build", status: values.status, ready_for_multica: values.ready_for_multica === "true", workflow_run_id: values.workflow_run_id || undefined, multica_parent: values.multica_parent || undefined, canary_path: values.canary_path || undefined };
}

export function buildVaultIdeaNoteMarkdown(roughIdea: string, meta: { status?: VaultIdeaNoteStatus; parentIdentifier?: string; workflowRunId?: string; canaryPath?: string; now?: Date } = {}): string {
  const date = (meta.now ?? new Date()).toISOString().slice(0, 10);
  const status = meta.status ?? "planned";
  const lines = ["---", `idea_note_schema_version: ${VAULT_IDEA_NOTE_SCHEMA_VERSION}`, "workflow_lane: idea-to-build", `status: ${status}`, "ready_for_multica: false"];
  if (meta.workflowRunId) lines.push(`workflow_run_id: ${meta.workflowRunId}`);
  if (meta.parentIdentifier) lines.push(`multica_parent: ${meta.parentIdentifier}`);
  if (meta.canaryPath) lines.push(`canary_path: ${meta.canaryPath}`);
  lines.push("tags:", "  - type/idea", "  - workflow/idea-to-build", `created: ${date}`, `modified: ${date}`, "---", "", "# Idea", "", roughIdea, "");
  if (meta.parentIdentifier) lines.push("## Multica workflow", "", `- Parent: \`${meta.parentIdentifier}\``, `- Workflow run: \`${meta.workflowRunId ?? "(pending)"}\``, meta.canaryPath ? `- Canary path: \`${meta.canaryPath}\`` : "", "");
  return `${lines.filter(Boolean).join("\n")}\n`;
}

export function validateVaultIdeaNoteForWrite(markdown: string): { ok: true } | { ok: false; error: string } {
  const parsed = parseVaultIdeaNoteFrontmatter(markdown);
  if ("error" in parsed && typeof parsed.error === "string") return { ok: false, error: parsed.error };
  return { ok: true };
}
