import { App, PluginSettingTab, Setting } from "obsidian";

import AgentDashboardPlugin from "./main";

export interface AgentDashboardSettings {
  agentSessionName: string;
  allowedExternalWorkspaceRoots: string;
  autoStartBridge: boolean;
  piToolMode: "disabled" | "read-only";
  piPromptTimeoutMinutes: number;
  piExecutablePath: string;
  selectedPiModel: string;
  ollamaHost: string;
  defaultModel: string;
  compactBlockHeight: number;
  permissionMode: "ask" | "trusted";
  safeCommandAllowlist: string;
  webFetchAllowedHosts: string;
  webFetchEnabled: boolean;
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
  agentSessionName: "default",
  allowedExternalWorkspaceRoots: "",
  autoStartBridge: true,
  piToolMode: "disabled",
  piPromptTimeoutMinutes: 10,
  piExecutablePath: "pi",
  selectedPiModel: "",
  ollamaHost: "http://127.0.0.1:11434",
  defaultModel: "",
  compactBlockHeight: 360,
  permissionMode: "ask",
  safeCommandAllowlist: [
    "git status",
    "git diff",
    "npm run typecheck",
    "npm run build"
  ].join("\n"),
  webFetchAllowedHosts: "",
  webFetchEnabled: false
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

    containerEl.createEl("h2", { text: "Local Sidekick" });

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
        "Reviewed edits mode is active. Shell commands and deletes are blocked. Approved agent-edit proposals can be applied to vault Markdown files."
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
      .setName("Agent session")
      .setDesc(
        "Persistent Pi session name. Changing it starts using a different stored conversation."
      )
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.agentSessionName)
          .setValue(this.plugin.settings.agentSessionName)
          .onChange(async (value) => {
            this.plugin.settings.agentSessionName =
              value.trim() || DEFAULT_SETTINGS.agentSessionName;
            this.plugin.resetPiSessionMetadata();
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
      .setName("Pi tools")
      .setDesc(
        "Disabled keeps Pi fully tool-free. Read-only enables Pi's read, grep, find, and ls tools from the vault root; bash, edit, and write stay disabled."
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("disabled", "Disabled")
          .addOption("read-only", "Read-only: read, grep, find, ls")
          .setValue(this.plugin.settings.piToolMode)
          .onChange(async (value) => {
            this.plugin.settings.piToolMode = value as "disabled" | "read-only";
            await this.plugin.saveSettings();
            this.plugin.refreshDashboardViews();
          })
      );

    new Setting(containerEl)
      .setName("Pi prompt timeout")
      .setDesc(
        "Maximum time to wait for a Pi response. Larger local models and read-only tools may need several minutes."
      )
      .addSlider((slider) =>
        slider
          .setLimits(2, 30, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.piPromptTimeoutMinutes)
          .onChange(async (value) => {
            this.plugin.settings.piPromptTimeoutMinutes = value;
            await this.plugin.saveSettings();
            this.plugin.refreshDashboardViews();
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
      .setDesc("Optional Ollama model name to preselect in sidekick blocks.")
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
      .setDesc("Default height, in pixels, for embedded sidekick blocks.")
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
      .setName("Safe command allowlist")
      .setDesc(
        "Exact commands the plugin may run with @cmd(...). Commands run without a shell from the vault root."
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("git status\nnpm run typecheck")
          .setValue(this.plugin.settings.safeCommandAllowlist)
          .onChange(async (value) => {
            this.plugin.settings.safeCommandAllowlist = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Web fetch")
      .setDesc(
        "Allow @url(...) prompt context. Local/private hosts are blocked; optional hosts below can narrow access further."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.webFetchEnabled)
          .onChange(async (value) => {
            this.plugin.settings.webFetchEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.refreshDashboardViews();
          })
      );

    new Setting(containerEl)
      .setName("Web fetch allowed hosts")
      .setDesc(
        "Optional host allowlist, one per line. Leave empty to allow public HTTP/HTTPS hosts when web fetch is enabled."
      )
      .addTextArea((text) =>
        text
          .setPlaceholder("arxiv.org\ngithub.com")
          .setValue(this.plugin.settings.webFetchAllowedHosts)
          .onChange(async (value) => {
            this.plugin.settings.webFetchAllowedHosts = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Permission mode")
      .setDesc(
        "Reserved for broader future permissions. Shell commands and deletes remain blocked."
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
