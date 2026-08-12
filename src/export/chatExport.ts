import type { AgentEvent } from "../agent/AgentSession";
import type { PersistedAgentSessionRecord } from "../types";
import { escapeHtml, yamlScalar } from "../util/text";
import { countConversationMessages } from "../session/persistence";

export interface ChatExportOptions {
  exportedAt: string;
  model: string;
  pluginVersion: string;
}

export function buildChatExportMarkdown(
  record: PersistedAgentSessionRecord,
  options: ChatExportOptions
): string {
  const title = record.title || record.name;
  const lines = [
    "---",
    `title: ${yamlScalar(title)}`,
    `agent_session: ${yamlScalar(record.name)}`,
    `exported_at: ${yamlScalar(options.exportedAt)}`,
    `model: ${yamlScalar(options.model || "unknown")}`,
    `plugin_version: ${yamlScalar(options.pluginVersion)}`,
    record.piSessionId ? `pi_session_id: ${yamlScalar(record.piSessionId)}` : "",
    `message_count: ${countConversationMessages(record.events ?? [])}`,
    "---",
    "",
    `# ${title}`,
    "",
    `Exported: ${options.exportedAt}`,
    "",
    `Session: \`${record.name}\``,
    options.model ? `Model: \`${options.model}\`` : "",
    "",
    ...formatChatExportEvents(record.events ?? [])
  ].filter((line) => line !== undefined);

  return `${lines.join("\n")}\n`;
}

function formatChatExportEvents(events: AgentEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (event.kind === "status") {
      lines.push(
        `> **Status ${formatExportTimestamp(event.createdAt)}:** ${event.text}`,
        ""
      );
      continue;
    }

    if (event.kind === "tool") {
      lines.push(
        `<details>`,
        `<summary>Tool · ${escapeHtml(event.tool?.title ?? event.text)}</summary>`,
        "",
        ...formatToolExport(event),
        "",
        `</details>`,
        ""
      );
      continue;
    }

    lines.push(
      `## ${getExportEventHeading(event)}`,
      "",
      event.text.trim() || "_No content_",
      ""
    );
  }

  return lines;
}

function formatToolExport(event: AgentEvent): string[] {
  const tool = event.tool;
  if (!tool) {
    return [event.text.trim() || "_No details_"];
  }

  const lines = [
    `- Status: \`${tool.status}\``,
    `- Event: \`${tool.eventType}\``,
    tool.name ? `- Name: \`${tool.name}\`` : "",
    tool.callId ? `- Call ID: \`${tool.callId}\`` : "",
    ""
  ].filter(Boolean);

  if (tool.input !== undefined) {
    lines.push("Input:", "", "```json", formatJsonForMarkdown(tool.input), "```", "");
  }

  if (tool.output !== undefined) {
    lines.push(
      tool.status === "error" ? "Error:" : "Output:",
      "",
      "```json",
      formatJsonForMarkdown(tool.output),
      "```",
      ""
    );
  }

  return lines;
}

function formatJsonForMarkdown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getExportEventHeading(event: AgentEvent): string {
  const label =
    event.kind === "assistant" ? "Agent" : event.kind === "user" ? "You" : "Event";
  return `${label} - ${formatExportTimestamp(event.createdAt)}`;
}

function formatExportTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString();
}
