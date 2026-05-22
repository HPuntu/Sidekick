import { App, PluginSettingTab, Setting } from "obsidian";

import AgentDashboardPlugin from "./main";

export interface AgentDashboardSettings {
  allowedExternalWorkspaceRoots: string;
  autoStartBridge: boolean;
  piExecutablePath: string;
  ollamaHost: string;
  defaultModel: string;
  compactBlockHeight: number;
  permissionMode: "ask" | "trusted";
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
  allowedExternalWorkspaceRoots: "",
  autoStartBridge: true,
  piExecutablePath: "pi",
  ollamaHost: "http://127.0.0.1:11434",
  defaultModel: "",
  compactBlockHeight: 360,
  permissionMode: "ask"
};

export class AgentDashboardSettingTab extends PluginSettingTab {
  plugin: AgentDashboardPlugin;

  constructor(app: App, plugin: AgentDashboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Agent Dashboard" });

    new Setting(containerEl)
      .setName("Start bridge automatically")
      .setDesc("Start the local health stub when Obsidian loads the plugin.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoStartBridge)
          .onChange(async (value) => {
            this.plugin.settings.autoStartBridge = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Safety mode")
      .setDesc(
        "Read-only is locked on. Pi execution, shell commands, file writes, and deletes are blocked until the approval queue is implemented."
      );

    new Setting(containerEl)
      .setName("Allowed external workspace roots")
      .setDesc(
        "Optional absolute folder paths, one per line. The vault root is allowed automatically for read-only context."
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("/Users/example/dev/project")
          .setValue(this.plugin.settings.allowedExternalWorkspaceRoots)
          .onChange(async (value) => {
            this.plugin.settings.allowedExternalWorkspaceRoots = value;
            await this.plugin.saveSettings();
            this.plugin.refreshDashboardViews();
          })
      );

    new Setting(containerEl)
      .setName("Pi executable")
      .setDesc("Command or absolute path used later by the local bridge.")
      .addText((text) =>
        text
          .setPlaceholder("pi")
          .setValue(this.plugin.settings.piExecutablePath)
          .onChange(async (value) => {
            this.plugin.settings.piExecutablePath = value.trim() || "pi";
            await this.plugin.saveSettings();
            this.plugin.resetPiStatus();
          })
      );

    new Setting(containerEl)
      .setName("Ollama host")
      .setDesc("Local Ollama server URL.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.ollamaHost)
          .setValue(this.plugin.settings.ollamaHost)
          .onChange(async (value) => {
            this.plugin.settings.ollamaHost =
              value.trim() || DEFAULT_SETTINGS.ollamaHost;
            await this.plugin.saveSettings();
            this.plugin.resetOllamaStatus();
          })
      );

    new Setting(containerEl)
      .setName("Default model")
      .setDesc("Optional Ollama model name to preselect in dashboard blocks.")
      .addText((text) =>
        text
          .setPlaceholder("qwen2.5-coder:latest")
          .setValue(this.plugin.settings.defaultModel)
          .onChange(async (value) => {
            this.plugin.settings.defaultModel = value.trim();
            await this.plugin.saveSettings();
            this.plugin.resetOllamaStatus();
          })
      );

    new Setting(containerEl)
      .setName("Compact block height")
      .setDesc("Default height, in pixels, for embedded dashboard blocks.")
      .addSlider((slider) =>
        slider
          .setLimits(240, 720, 20)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.compactBlockHeight)
          .onChange(async (value) => {
            this.plugin.settings.compactBlockHeight = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Permission mode")
      .setDesc(
        "Reserved for the future approval queue. Disabled while read-only safety mode is active."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ask", "Ask every time")
          .addOption("trusted", "Trusted workspace")
          .setValue(this.plugin.settings.permissionMode)
          .setDisabled(true)
          .onChange(async (value) => {
            this.plugin.settings.permissionMode = value as "ask" | "trusted";
            await this.plugin.saveSettings();
          })
      );
  }
}
