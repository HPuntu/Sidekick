import { ItemView, WorkspaceLeaf } from "obsidian";

import type AgentDashboardPlugin from "../main";
import { renderDashboardShell } from "../ui/renderDashboard";

export const AGENT_DASHBOARD_VIEW_TYPE = "local-sidekick-view";

export class AgentDashboardView extends ItemView {
  plugin: AgentDashboardPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: AgentDashboardPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return AGENT_DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Local Sidekick";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    renderDashboardShell(this.plugin, this.contentEl, {
      embedded: false,
      workspace: "vault",
      layout: "agent-sidebar"
    });
  }
}
