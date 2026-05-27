import type { MarkdownPostProcessorContext } from "obsidian";

import type AgentDashboardPlugin from "../main";
import type { DashboardRenderOptions } from "../ui/renderDashboard";
import { renderDashboardShell } from "../ui/renderDashboard";

export function registerAgentDashboardBlock(
  plugin: AgentDashboardPlugin
): void {
  const renderBlock = (
    source: string,
    el: HTMLElement,
    _ctx: MarkdownPostProcessorContext
  ) => {
    const options = parseBlockOptions(source);
    renderDashboardShell(plugin, el, {
      ...options,
      embedded: true
    });
  };

  plugin.registerMarkdownCodeBlockProcessor("sidekick", renderBlock);
  plugin.registerMarkdownCodeBlockProcessor("agent-dashboard", renderBlock);
}

function parseBlockOptions(source: string): Omit<DashboardRenderOptions, "embedded"> {
  const options: Omit<DashboardRenderOptions, "embedded"> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (isBlockOptionKey(key)) {
      options[key] = value;
    }
  }

  return options;
}

function isBlockOptionKey(
  key: string
): key is keyof Omit<DashboardRenderOptions, "embedded"> {
  return [
    "workspace",
    "mode",
    "layout",
    "session",
    "model"
  ].includes(key);
}
