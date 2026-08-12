import { MarkdownRenderChild } from "obsidian";
import type { MarkdownPostProcessorContext } from "obsidian";

import type AgentDashboardPlugin from "../main";
import type {
  DashboardHost,
  DashboardRenderOptions
} from "../ui/renderDashboard";
import {
  createDashboardUiState,
  renderDashboardShell
} from "../ui/renderDashboard";

/** Block options, minus the fields the host supplies. */
type BlockOptions = Omit<DashboardRenderOptions, "embedded" | "host">;

export function registerAgentDashboardBlock(
  plugin: AgentDashboardPlugin
): void {
  const renderBlock = (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) => {
    const options = parseBlockOptions(source);
    // The embedded block is a static header with an "Open" button, so its
    // host only needs to be able to repaint itself in place. The render child
    // ties any markdown cleanup to the lifetime of the block.
    const renderChild = new MarkdownRenderChild(el);
    ctx.addChild(renderChild);
    const host: DashboardHost = {
      markdownComponent: renderChild,
      rerender: () => {
        renderDashboardShell(plugin, el, { ...options, embedded: true, host });
      },
      ui: createDashboardUiState()
    };

    renderDashboardShell(plugin, el, {
      ...options,
      embedded: true,
      host
    });
  };

  plugin.registerMarkdownCodeBlockProcessor("sidekick", renderBlock);
  plugin.registerMarkdownCodeBlockProcessor("agent-dashboard", renderBlock);
}

function parseBlockOptions(source: string): BlockOptions {
  const options: BlockOptions = {};

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

function isBlockOptionKey(key: string): key is keyof BlockOptions {
  return [
    "workspace",
    "mode",
    "layout",
    "session",
    "model"
  ].includes(key);
}
