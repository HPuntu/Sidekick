import { App, ButtonComponent, Modal } from "obsidian";

import type AgentDashboardPlugin from "../../main";

export class AgentChatExportModal extends Modal {
  private plugin: AgentDashboardPlugin;

  constructor(app: App, plugin: AgentDashboardPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Export chat" });
    contentEl.createEl("p", {
      text: "Choose a vault path. The default folder is created if needed."
    });

    const inputEl = contentEl.createEl("input", {
      attr: {
        type: "text"
      },
      cls: "agent-dashboard__export-path-input"
    });
    inputEl.value = this.plugin.getSuggestedChatExportPath();
    inputEl.focus();
    inputEl.select();

    const actionsEl = contentEl.createDiv({
      cls: "agent-dashboard__export-actions"
    });
    new ButtonComponent(actionsEl)
      .setButtonText("Cancel")
      .onClick(() => {
        this.close();
      });
    new ButtonComponent(actionsEl)
      .setCta()
      .setButtonText("Export")
      .onClick(() => {
        void this.plugin.exportActiveAgentChat(inputEl.value);
        this.close();
      });

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.plugin.exportActiveAgentChat(inputEl.value);
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
