import { stripVTControlCharacters } from "node:util";
import type { OperationsViewV1 } from "./operations-view.ts";
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
export function escapeTerminalText(value: string): string { return stripVTControlCharacters(value).replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(CONTROL_RE, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`); }
export function truncateGraphemes(value: string, maxGraphemes: number): string { const parts = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)].map((item) => item.segment); return parts.length <= maxGraphemes ? value : `${parts.slice(0, maxGraphemes).join("")}…`; }
export interface RenderHumanOptions { columns?: number; color?: boolean; verbose?: boolean }
export function renderOperationsViewHuman(view: OperationsViewV1, options: RenderHumanOptions = {}): string {
  const stack = (options.columns ?? 120) < 100; const lines: string[] = [];
  if (view.retentionBanner) lines.push(view.retentionBanner, "");
  lines.push("NEXT", `Next: ${view.nextAction.command}`, "");
  if (view.actionRequired.length) { lines.push(`ACTION REQUIRED (${view.actionRequired.length})`); for (const item of view.actionRequired) { if (stack) lines.push(`What: ${escapeTerminalText(truncateGraphemes(item.what, 120))}`, `Why: ${escapeTerminalText(truncateGraphemes(item.why, 120))}`, `Next: ${item.next}`, ""); else lines.push(`- ${escapeTerminalText(truncateGraphemes(item.what, 80))} | Why: ${escapeTerminalText(truncateGraphemes(item.why, 80))} | Next: ${item.next}`); } lines.push(""); }
  lines.push("SUMMARY", `ACTIVE ${view.summary.active} / READY ${view.summary.ready} / CLEANUP ${view.summary.cleanup} / BLOCKED ${view.summary.blocked} / UNKNOWN ${view.summary.unknown} / TOTAL ${view.summary.total}`, view.summary.noActionRequired ? "No action required." : "", "");
  if (view.readyItem) lines.push("READY", escapeTerminalText(view.readyItem.label), `Next: ${view.readyItem.next}`, "");
  if (view.truncated && view.nextCursor) lines.push(`Showing ${view.actionRequired.length} of ${view.summary.total}`, `Next: /skill:idea-status --cursor ${view.nextCursor}`, "");
  if (options.verbose) { lines.push("DETAILS", `dataState=${view.dataState}`, `generatedAt=${view.generatedAt}`); for (const source of view.sources) lines.push(`source ${source.sourceId} status=${source.status}`); }
  return `${lines.filter((line, index, array) => !(line === "" && array[index - 1] === "")).join("\n")}\n`;
}
export function renderOperationsViewJson(view: OperationsViewV1): string { return `${JSON.stringify(view, null, 2)}\n`; }
export function shouldUseColor(isTty: boolean, env: NodeJS.ProcessEnv = process.env, noColorFlag = false): boolean { return Boolean(isTty && !noColorFlag && env.NO_COLOR === undefined); }
export function renderOperationsReport(view: OperationsViewV1, options: { json?: boolean; verbose?: boolean; isTty?: boolean; columns?: number; noColor?: boolean; env?: NodeJS.ProcessEnv } = {}): string {
  return options.json ? renderOperationsViewJson(view) : renderOperationsViewHuman(view, { verbose: options.verbose, columns: options.columns, color: shouldUseColor(options.isTty ?? false, options.env, options.noColor) });
}
