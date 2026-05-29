import { ButtonComponent, MarkdownRenderer, setIcon, TFile } from "obsidian";

import type AgentDashboardPlugin from "../main";
import type { AgentSessionHistoryItem, ProposedEditRecord } from "../main";
import type { AgentEvent, AgentToolEvent } from "../agent/AgentSession";
import type { ProposedEditDiffLine } from "../agent/ProposedEdit";
import type { BridgeSnapshot } from "../bridge/BridgeService";
import type { OllamaSnapshot } from "../bridge/ollama/OllamaClient";
import type { PiSnapshot } from "../bridge/pi/PiProbe";
import type { PiRpcDiscoverySnapshot } from "../bridge/pi/PiRpcDiscovery";
import type { ApprovalRecord } from "../security/ApprovalQueue";
import { summarizeAllowedRoots } from "../security/SafetyPolicy";

export interface DashboardRenderOptions {
  embedded: boolean;
  workspace?: string;
  mode?: string;
  layout?: string;
  session?: string;
  model?: string;
}
const STATUS_PANEL_MIN_HEIGHT = 96;
const STATUS_PANEL_MAX_HEIGHT = 420;
const AGENT_PANEL_MIN_HEIGHT = 220;
const PANEL_RESIZE_KEY_STEP = 16;

export function renderDashboardShell(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  containerEl.empty();
  containerEl.addClass("agent-dashboard");
  containerEl.toggleClass("agent-dashboard--embedded", options.embedded);
  containerEl.toggleClass("agent-dashboard--standalone", !options.embedded);

  if (options.embedded) {
    containerEl.style.minHeight = `${plugin.settings.compactBlockHeight}px`;
  }

  const headerEl = containerEl.createDiv({ cls: "agent-dashboard__header" });
  const titleWrapEl = headerEl.createDiv({ cls: "agent-dashboard__title-wrap" });
  const titleIconEl = titleWrapEl.createSpan({
    attr: { "aria-label": "Local Sidekick", title: "Local Sidekick" },
    cls: "agent-dashboard__title-icon"
  });
  setIcon(titleIconEl, "bot");
  titleWrapEl.createEl("p", {
    text: describeDashboard(plugin, options)
  });

  const actionsEl = headerEl.createDiv({ cls: "agent-dashboard__actions" });

  new ButtonComponent(actionsEl)
    .setButtonText(options.embedded ? "Open" : "Refresh")
    .setTooltip(options.embedded ? "Open full dashboard" : "Refresh status")
    .onClick(async () => {
      if (options.embedded) {
        await plugin.activateView();
        return;
      }

      await plugin.refreshOllamaStatus(true);
      renderDashboardShell(plugin, containerEl, options);
    });

  const bodyEl = containerEl.createDiv({ cls: "agent-dashboard__body" });
  const statusPanelEl = renderStatusPanel(plugin, bodyEl, options);
  if (!options.embedded) {
    renderPanelResizeHandle(plugin, bodyEl, statusPanelEl);
  }
  renderAgentPanel(plugin, bodyEl, options);
}

function renderStatusPanel(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  options: DashboardRenderOptions
): HTMLElement {
  const panelEl = containerEl.createDiv({
    cls: "agent-dashboard__panel agent-dashboard__panel--status"
  });
  setStatusPanelHeight(
    panelEl,
    plugin.settings.statusPanelHeight,
    getMaxStatusPanelHeight(containerEl)
  );
  const headingEl = panelEl.createDiv({ cls: "agent-dashboard__panel-heading" });
  headingEl.createEl("h4", { text: "Status" });

  const bridgeSnapshot = plugin.bridge.getSnapshot();
  const rootEl = containerEl.parentElement ?? containerEl;
  const controlsEl = headingEl.createDiv({
    cls: "agent-dashboard__panel-controls"
  });

  new ButtonComponent(controlsEl)
    .setButtonText("Ollama")
    .setTooltip("Check Ollama status")
    .onClick(async () => {
      await plugin.refreshOllamaStatus(true);
      renderDashboardShell(plugin, rootEl, options);
    });

  new ButtonComponent(controlsEl)
    .setButtonText("Pi")
    .setTooltip("Check Pi executable")
    .onClick(async () => {
      await plugin.refreshPiStatus(true);
      renderDashboardShell(plugin, rootEl, options);
    });

  new ButtonComponent(controlsEl)
    .setButtonText("RPC")
    .setTooltip("Discover Pi RPC readiness")
    .onClick(async () => {
      await plugin.refreshPiRpcDiscovery(true);
      renderDashboardShell(plugin, rootEl, options);
    });

  new ButtonComponent(controlsEl)
    .setButtonText(bridgeSnapshot.status === "running" ? "Restart" : "Start")
    .setTooltip("Start or restart local bridge")
    .onClick(async () => {
      if (bridgeSnapshot.status === "running") {
        await plugin.bridge.restart();
      } else {
        await plugin.bridge.start();
      }

      renderDashboardShell(plugin, rootEl, options);
    });

  if (bridgeSnapshot.status === "running") {
    new ButtonComponent(controlsEl)
      .setButtonText("Stop")
      .setTooltip("Stop local bridge")
      .onClick(async () => {
        await plugin.bridge.stop();
        renderDashboardShell(plugin, rootEl, options);
      });
  }

  const listEl = panelEl.createDiv({ cls: "agent-dashboard__status-list" });
  renderBridgeStatusItem(listEl, bridgeSnapshot);
  renderPiStatusItems(listEl, plugin.piSnapshot);
  renderPiRpcStatusItems(listEl, plugin.piRpcDiscoverySnapshot);
  renderOllamaStatusItems(listEl, plugin.ollamaSnapshot);
  renderSafetyStatusItems(plugin, listEl);
  renderStatusItem(listEl, "Agent", plugin.agentSessionStatus);
  renderStatusItem(
    listEl,
    "Selected Pi",
    plugin.settings.selectedPiModel || "not selected"
  );
  renderStatusItem(listEl, "Workspace", options.workspace ?? "vault");
  renderStatusItem(listEl, "Session", plugin.getAgentSessionSummary());

  return panelEl;
}

function renderPanelResizeHandle(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  statusPanelEl: HTMLElement
): void {
  const handleEl = containerEl.createDiv({
    cls: "agent-dashboard__panel-resize-handle"
  });
  handleEl.setAttr("role", "separator");
  handleEl.setAttr("aria-orientation", "horizontal");
  handleEl.setAttr("aria-label", "Resize status and agent panels");
  handleEl.setAttr("tabindex", "0");
  handleEl.setAttr("title", "Drag to resize Status and Agent panels");
  updateResizeHandleValue(handleEl, plugin.settings.statusPanelHeight, containerEl);

  handleEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const startY = event.clientY;
    const startHeight = statusPanelEl.getBoundingClientRect().height;
    const ownerDocument = handleEl.ownerDocument;
    containerEl.addClass("is-resizing-panels");

    const updateHeight = (clientY: number): void => {
      const nextHeight = clampStatusPanelHeight(
        startHeight + clientY - startY,
        getMaxStatusPanelHeight(containerEl)
      );
      setStatusPanelHeight(statusPanelEl, nextHeight);
      plugin.settings.statusPanelHeight = Math.round(nextHeight);
      updateResizeHandleValue(handleEl, nextHeight, containerEl);
    };

    const onPointerMove = (moveEvent: PointerEvent): void => {
      moveEvent.preventDefault();
      updateHeight(moveEvent.clientY);
    };

    const stopResize = (): void => {
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", stopResize);
      ownerDocument.removeEventListener("pointercancel", stopResize);
      containerEl.removeClass("is-resizing-panels");
      void plugin.saveSettings();
    };

    ownerDocument.addEventListener("pointermove", onPointerMove);
    ownerDocument.addEventListener("pointerup", stopResize);
    ownerDocument.addEventListener("pointercancel", stopResize);
  });

  handleEl.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }

    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextHeight = clampStatusPanelHeight(
      plugin.settings.statusPanelHeight + direction * PANEL_RESIZE_KEY_STEP,
      getMaxStatusPanelHeight(containerEl)
    );
    plugin.settings.statusPanelHeight = Math.round(nextHeight);
    setStatusPanelHeight(statusPanelEl, nextHeight);
    updateResizeHandleValue(handleEl, nextHeight, containerEl);
    void plugin.saveSettings();
  });

  handleEl.addEventListener("dblclick", () => {
    const nextHeight = clampStatusPanelHeight(
      160,
      getMaxStatusPanelHeight(containerEl)
    );
    plugin.settings.statusPanelHeight = Math.round(nextHeight);
    setStatusPanelHeight(statusPanelEl, nextHeight);
    updateResizeHandleValue(handleEl, nextHeight, containerEl);
    void plugin.saveSettings();
  });
}

function setStatusPanelHeight(
  panelEl: HTMLElement,
  height: number,
  maxHeight = STATUS_PANEL_MAX_HEIGHT
): void {
  const nextHeight = clampStatusPanelHeight(height, maxHeight);
  panelEl.style.flexBasis = nextHeight + "px";
  panelEl.style.height = nextHeight + "px";
}

function updateResizeHandleValue(
  handleEl: HTMLElement,
  height: number,
  containerEl: HTMLElement
): void {
  handleEl.setAttr("aria-valuemin", String(STATUS_PANEL_MIN_HEIGHT));
  handleEl.setAttr("aria-valuemax", String(getMaxStatusPanelHeight(containerEl)));
  handleEl.setAttr("aria-valuenow", String(Math.round(height)));
}

function getMaxStatusPanelHeight(containerEl: HTMLElement): number {
  const containerHeight = containerEl.getBoundingClientRect().height;
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return STATUS_PANEL_MAX_HEIGHT;
  }

  const availableHeight = Math.floor(
    containerHeight - AGENT_PANEL_MIN_HEIGHT - 24
  );
  return Math.max(
    STATUS_PANEL_MIN_HEIGHT,
    Math.min(STATUS_PANEL_MAX_HEIGHT, availableHeight)
  );
}

function clampStatusPanelHeight(
  height: number,
  maxHeight = STATUS_PANEL_MAX_HEIGHT
): number {
  if (!Number.isFinite(height)) {
    return 160;
  }

  return Math.min(
    maxHeight,
    Math.max(STATUS_PANEL_MIN_HEIGHT, Math.round(height))
  );
}

function renderBridgeStatusItem(
  containerEl: HTMLElement,
  snapshot: BridgeSnapshot
): void {
  const value =
    snapshot.status === "running" && snapshot.url
      ? `${snapshot.status} at ${snapshot.url}`
      : snapshot.error
        ? `${snapshot.status}: ${snapshot.error}`
        : snapshot.status;

  renderStatusItem(containerEl, "Bridge", value);
}

function renderOllamaStatusItems(
  containerEl: HTMLElement,
  snapshot: OllamaSnapshot
): void {
  const status =
    snapshot.status === "running" && snapshot.version
      ? `running ${snapshot.version}`
      : snapshot.error
        ? `${snapshot.status}: ${snapshot.error}`
        : snapshot.status;

  renderStatusItem(containerEl, "Ollama", status);
  renderStatusItem(containerEl, "Host", snapshot.host);
  renderStatusItem(containerEl, "Models", describeModels(snapshot));

  if (snapshot.selectedModel) {
    renderStatusItem(
      containerEl,
      "Selected",
      snapshot.selectedModelAvailable === false
        ? `${snapshot.selectedModel} (missing)`
        : snapshot.selectedModel
    );
  }
}

function renderPiStatusItems(
  containerEl: HTMLElement,
  snapshot: PiSnapshot
): void {
  const status =
    snapshot.status === "available" && snapshot.version
      ? snapshot.version
      : snapshot.error
        ? `${snapshot.status}: ${snapshot.error}`
        : snapshot.status;

  renderStatusItem(containerEl, "Pi", status);
  renderStatusItem(containerEl, "Pi path", snapshot.executablePath);

  if (snapshot.probe) {
    renderStatusItem(containerEl, "Pi probe", snapshot.probe);
  }
}

function renderPiRpcStatusItems(
  containerEl: HTMLElement,
  snapshot: PiRpcDiscoverySnapshot
): void {
  const status =
    snapshot.status === "ready"
      ? describePiRpcReady(snapshot)
      : snapshot.error
        ? `${snapshot.status}: ${snapshot.error}`
        : snapshot.status;

  renderStatusItem(containerEl, "Pi RPC", status);

  if (snapshot.currentModel) {
    renderStatusItem(containerEl, "RPC model", snapshot.currentModel);
  }

  if (snapshot.modelCount !== undefined) {
    renderStatusItem(containerEl, "RPC models", String(snapshot.modelCount));
  }

  if (snapshot.models.length > 0) {
    renderStatusItem(containerEl, "RPC list", describePiRpcModels(snapshot));
  }
}

function describePiRpcReady(snapshot: PiRpcDiscoverySnapshot): string {
  const commandCount = snapshot.commandCount ?? 0;
  const responseCount = snapshot.responseCount ?? 0;
  return `ready (${responseCount}/${commandCount} discovery responses)`;
}

function describePiRpcModels(snapshot: PiRpcDiscoverySnapshot): string {
  const names = snapshot.models.slice(0, 3).map((model) => model.label);
  const extraCount = snapshot.models.length - names.length;

  if (extraCount > 0) {
    return `${names.join(", ")} +${extraCount}`;
  }

  return names.join(", ");
}

function describeModels(snapshot: OllamaSnapshot): string {
  if (snapshot.status === "checking") {
    return "checking...";
  }

  if (snapshot.status !== "running") {
    return "unknown";
  }

  if (snapshot.models.length === 0) {
    return "none found";
  }

  const names = snapshot.models.slice(0, 3).map((model) => model.name);
  const extraCount = snapshot.models.length - names.length;

  if (extraCount > 0) {
    return `${names.join(", ")} +${extraCount}`;
  }

  return names.join(", ");
}

function renderSafetyStatusItems(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement
): void {
  const snapshot = plugin.getSafetySnapshot();
  renderStatusItem(containerEl, "Safety", snapshot.mode);
  renderStatusItem(containerEl, "Pi tools", describePiToolMode(plugin.settings.piToolMode));
  renderStatusItem(
    containerEl,
    "Pi extras",
    plugin.settings.piExperimentalFeaturesEnabled ? "experimental" : "disabled"
  );
  renderStatusItem(
    containerEl,
    "Timeout",
    `${plugin.settings.piPromptTimeoutMinutes} min`
  );
  renderStatusItem(containerEl, "Roots", summarizeAllowedRoots(snapshot));
  renderStatusItem(containerEl, "Approvals", String(snapshot.pendingApprovals));
  renderStatusItem(
    containerEl,
    "Audit",
    `${plugin.safetyAuditLog.length} decisions`
  );

  if (plugin.lastSafetyDecision) {
    renderStatusItem(
      containerEl,
      "Last guard",
      plugin.lastSafetyDecision.allowed ? "allowed" : "blocked"
    );
  }
}

function describePiToolMode(toolMode: "disabled" | "read-only"): string {
  if (toolMode === "read-only") {
    return "read, grep, find, ls";
  }

  return "disabled";
}

function renderAgentPanel(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  const panelEl = containerEl.createDiv({
    cls: "agent-dashboard__panel agent-dashboard__panel--agent"
  });
  const headingEl = panelEl.createDiv({ cls: "agent-dashboard__panel-heading" });

  const rootEl = containerEl.parentElement ?? containerEl;
  if (plugin.agentViewMode === "chat") {
    const titleEl = headingEl.createDiv({
      cls: "agent-dashboard__chat-title"
    });
    new ButtonComponent(titleEl)
      .setIcon("arrow-left")
      .setTooltip("Back to sessions")
      .onClick(() => {
        void plugin.showAgentHistory();
        renderDashboardShell(plugin, rootEl, options);
    });
    titleEl.createEl("h4", { text: "Agent" });
    renderCurrentAgentProfilePill(plugin, titleEl);
    renderCurrentModelPill(plugin, titleEl);
  } else {
    headingEl.createEl("h4", { text: "Sessions" });
  }

  const controlsEl = headingEl.createDiv({
    cls: "agent-dashboard__panel-controls"
  });

  renderAgentProfileSelector(plugin, panelEl, rootEl, options);
  renderModelSelector(plugin, panelEl, rootEl, options);

  if (plugin.agentViewMode === "history") {
    renderAgentHistoryPage(plugin, panelEl, rootEl, options);
    return;
  }

  if (plugin.agentSessionStatus === "running") {
    new ButtonComponent(controlsEl)
      .setButtonText("Stop")
      .setTooltip("Stop current agent run")
      .onClick(() => {
        plugin.stopAgentRun();
        renderDashboardShell(plugin, rootEl, options);
      });
  }

  new ButtonComponent(controlsEl)
    .setButtonText("Clear")
    .setTooltip("Clear agent event stream")
    .onClick(() => {
      plugin.clearAgentEvents();
      renderDashboardShell(plugin, rootEl, options);
    });

  new ButtonComponent(controlsEl)
    .setButtonText("New")
    .setTooltip("Start a fresh persistent Pi session")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(() => {
      void plugin.startNewAgentSession();
      renderDashboardShell(plugin, rootEl, options);
    });

  new ButtonComponent(controlsEl)
    .setButtonText("Export")
    .setTooltip("Export chat to Markdown")
    .setDisabled(
      plugin.agentSessionStatus === "running" || plugin.agentEvents.length === 0
    )
    .onClick(() => {
      plugin.openChatExportModal();
    });

  renderApprovalQueue(plugin, panelEl, rootEl, options);

  const streamEl = panelEl.createDiv({ cls: "agent-dashboard__event-stream" });
  if (plugin.agentEvents.length === 0) {
    streamEl.createEl("p", {
      cls: "agent-dashboard__empty",
      text: "No agent events yet."
    });
  } else {
    for (const event of plugin.agentEvents) {
      renderAgentEvent(plugin, streamEl, event);
    }
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  const composerEl = panelEl.createDiv({ cls: "agent-dashboard__composer" });
  const promptEl = composerEl.createEl("textarea", {
    cls: "agent-dashboard__prompt-input",
    attr: {
      placeholder: "Ask the agent... Try /agent research-tutor on the first line",
      rows: "3"
    }
  });
  promptEl.disabled = plugin.agentSessionStatus === "running";
  const suggestionsEl = composerEl.createDiv({
    cls: "agent-dashboard__mention-suggestions"
  });
  suggestionsEl.hide();
  let mentionSuggestions: string[] = [];
  let selectedMentionIndex = 0;

  promptEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void sendPrompt("none");
      closeMentionSuggestions();
      return;
    }

    if (!suggestionsEl.hasClass("is-visible")) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedMentionIndex = Math.min(
        selectedMentionIndex + 1,
        mentionSuggestions.length - 1
      );
      renderMentionSuggestions();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
      renderMentionSuggestions();
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptMentionSuggestion(mentionSuggestions[selectedMentionIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMentionSuggestions();
    }
  });
  promptEl.addEventListener("input", () => {
    updateMentionSuggestions();
  });
  promptEl.addEventListener("click", () => {
    updateMentionSuggestions();
  });

  const composerActionsEl = composerEl.createDiv({
    cls: "agent-dashboard__composer-actions"
  });
  new ButtonComponent(composerActionsEl)
    .setButtonText(plugin.agentSessionStatus === "running" ? "Running" : "Send")
    .setTooltip("Send prompt")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(() => {
      void sendPrompt("none");
    });

  new ButtonComponent(composerActionsEl)
    .setButtonText("Note")
    .setTooltip("Send prompt with current note context")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(() => {
      void sendPrompt("note");
    });

  new ButtonComponent(composerActionsEl)
    .setButtonText("Selection")
    .setTooltip("Send prompt with selected text context")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(() => {
      void sendPrompt("selection");
    });

  new ButtonComponent(composerActionsEl)
    .setButtonText("Vault")
    .setTooltip("Send prompt with vault search and related-note context")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(() => {
      void sendPrompt("vault");
    });

  new ButtonComponent(composerActionsEl)
    .setButtonText("Links")
    .setTooltip("Suggest conservative internal links for the current note")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(() => {
      void plugin.suggestInternalLinksForActiveNote();
      renderDashboardShell(plugin, rootEl, options);
    });

  async function sendPrompt(
    contextMode: "none" | "note" | "selection" | "vault"
  ): Promise<void> {
    const accepted = await plugin.sendAgentPrompt(promptEl.value, contextMode);
    if (!accepted) {
      return;
    }

    promptEl.value = "";
    closeMentionSuggestions();
    renderDashboardShell(plugin, rootEl, options);
  }

  function updateMentionSuggestions(): void {
    const mention = getActiveMention(promptEl);
    if (!mention) {
      closeMentionSuggestions();
      return;
    }

    mentionSuggestions = plugin.getVaultFileSuggestions(mention.query);
    selectedMentionIndex = 0;

    if (mentionSuggestions.length === 0) {
      closeMentionSuggestions();
      return;
    }

    renderMentionSuggestions();
  }

  function renderMentionSuggestions(): void {
    suggestionsEl.empty();
    suggestionsEl.show();
    suggestionsEl.addClass("is-visible");

    for (let index = 0; index < mentionSuggestions.length; index += 1) {
      const suggestion = mentionSuggestions[index];
      const itemEl = suggestionsEl.createDiv({
        cls: "agent-dashboard__mention-suggestion",
        text: suggestion
      });
      itemEl.toggleClass("is-selected", index === selectedMentionIndex);
      itemEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        acceptMentionSuggestion(suggestion);
      });
    }
  }

  function closeMentionSuggestions(): void {
    mentionSuggestions = [];
    selectedMentionIndex = 0;
    suggestionsEl.removeClass("is-visible");
    suggestionsEl.hide();
    suggestionsEl.empty();
  }

  function acceptMentionSuggestion(suggestion: string | undefined): void {
    if (!suggestion) {
      closeMentionSuggestions();
      return;
    }

    const mention = getActiveMention(promptEl);
    if (!mention) {
      closeMentionSuggestions();
      return;
    }

    const value = promptEl.value;
    const suffix = value.slice(mention.end);
    const trailingSpace = suffix.length > 0 && !/^\s/.test(suffix) ? " " : "";
    const insertion = mention.query.startsWith("[[")
      ? `@[[${suggestion.replace(/\.md$/i, "")}]]${trailingSpace}`
      : `@${suggestion}${trailingSpace}`;
    promptEl.value = `${value.slice(0, mention.start)}${insertion}${suffix}`;
    const cursor = mention.start + insertion.length;
    promptEl.setSelectionRange(cursor, cursor);
    promptEl.focus();
    closeMentionSuggestions();
  }
}

function renderAgentHistoryPage(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  rootEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  const pageEl = containerEl.createDiv({
    cls: "agent-dashboard__session-page"
  });

  const composerEl = pageEl.createDiv({
    cls: "agent-dashboard__session-composer"
  });
  const promptEl = composerEl.createEl("textarea", {
    cls: "agent-dashboard__prompt-input",
    attr: {
      placeholder: "Start a new chat... Try /agent research-tutor on the first line",
      rows: "3"
    }
  });
  const suggestionsEl = composerEl.createDiv({
    cls: "agent-dashboard__mention-suggestions"
  });
  suggestionsEl.hide();
  let mentionSuggestions: string[] = [];
  let selectedMentionIndex = 0;

  const actionsEl = composerEl.createDiv({
    cls: "agent-dashboard__composer-actions"
  });

  new ButtonComponent(actionsEl)
    .setButtonText("Send")
    .setTooltip("Start a new chat")
    .onClick(() => {
      void startSession("none");
    });
  new ButtonComponent(actionsEl)
    .setButtonText("Note")
    .setTooltip("Start a new chat with current note context")
    .onClick(() => {
      void startSession("note");
    });
  new ButtonComponent(actionsEl)
    .setButtonText("Selection")
    .setTooltip("Start a new chat with selected text context")
    .onClick(() => {
      void startSession("selection");
    });
  new ButtonComponent(actionsEl)
    .setButtonText("Vault")
    .setTooltip("Start a new chat with vault search and related-note context")
    .onClick(() => {
      void startSession("vault");
    });

  promptEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void startSession("none");
      closeMentionSuggestions();
      return;
    }

    if (!suggestionsEl.hasClass("is-visible")) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedMentionIndex = Math.min(
        selectedMentionIndex + 1,
        mentionSuggestions.length - 1
      );
      renderMentionSuggestions();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedMentionIndex = Math.max(selectedMentionIndex - 1, 0);
      renderMentionSuggestions();
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      acceptMentionSuggestion(mentionSuggestions[selectedMentionIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMentionSuggestions();
    }
  });
  promptEl.addEventListener("input", () => {
    updateMentionSuggestions();
  });
  promptEl.addEventListener("click", () => {
    updateMentionSuggestions();
  });

  const historyEl = pageEl.createDiv({
    cls: "agent-dashboard__session-history"
  });
  const headingEl = historyEl.createDiv({
    cls: "agent-dashboard__session-history-heading"
  });
  headingEl.createSpan({ text: "Recent chats" });
  new ButtonComponent(headingEl)
    .setButtonText("New")
    .setTooltip("Open an empty new chat")
    .onClick(() => {
      void plugin.startNewAgentSession();
      renderDashboardShell(plugin, rootEl, options);
    });

  const sessions = plugin.getAgentSessionHistory();
  if (sessions.length === 0) {
    historyEl.createEl("p", {
      cls: "agent-dashboard__empty",
      text: "No chats yet."
    });
  } else {
    const listEl = historyEl.createDiv({
      cls: "agent-dashboard__session-list"
    });
    for (const session of sessions) {
      renderSessionHistoryItem(plugin, listEl, rootEl, options, session);
    }
  }

  async function startSession(
    contextMode: "none" | "note" | "selection" | "vault"
  ): Promise<void> {
    const prompt = promptEl.value.trim();
    if (!prompt) {
      return;
    }

    await plugin.startNewAgentSession();
    const accepted = await plugin.sendAgentPrompt(prompt, contextMode);
    if (accepted) {
      promptEl.value = "";
      closeMentionSuggestions();
    }
    renderDashboardShell(plugin, rootEl, options);
  }

  function updateMentionSuggestions(): void {
    const mention = getActiveMention(promptEl);
    if (!mention) {
      closeMentionSuggestions();
      return;
    }

    mentionSuggestions = plugin.getVaultFileSuggestions(mention.query);
    selectedMentionIndex = 0;

    if (mentionSuggestions.length === 0) {
      closeMentionSuggestions();
      return;
    }

    renderMentionSuggestions();
  }

  function renderMentionSuggestions(): void {
    suggestionsEl.empty();
    suggestionsEl.show();
    suggestionsEl.addClass("is-visible");

    for (let index = 0; index < mentionSuggestions.length; index += 1) {
      const suggestion = mentionSuggestions[index];
      const itemEl = suggestionsEl.createDiv({
        cls: "agent-dashboard__mention-suggestion",
        text: suggestion
      });
      itemEl.toggleClass("is-selected", index === selectedMentionIndex);
      itemEl.addEventListener("mousedown", (event) => {
        event.preventDefault();
        acceptMentionSuggestion(suggestion);
      });
    }
  }

  function closeMentionSuggestions(): void {
    mentionSuggestions = [];
    selectedMentionIndex = 0;
    suggestionsEl.removeClass("is-visible");
    suggestionsEl.hide();
    suggestionsEl.empty();
  }

  function acceptMentionSuggestion(suggestion: string | undefined): void {
    if (!suggestion) {
      closeMentionSuggestions();
      return;
    }

    const mention = getActiveMention(promptEl);
    if (!mention) {
      closeMentionSuggestions();
      return;
    }

    const value = promptEl.value;
    const suffix = value.slice(mention.end);
    const trailingSpace = suffix.length > 0 && !/^\s/.test(suffix) ? " " : "";
    const insertion = mention.query.startsWith("[[")
      ? `@[[${suggestion.replace(/\.md$/i, "")}]]${trailingSpace}`
      : `@${suggestion}${trailingSpace}`;
    promptEl.value = `${value.slice(0, mention.start)}${insertion}${suffix}`;
    const cursor = mention.start + insertion.length;
    promptEl.setSelectionRange(cursor, cursor);
    promptEl.focus();
    closeMentionSuggestions();
  }
}

function renderSessionHistoryItem(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  rootEl: HTMLElement,
  options: DashboardRenderOptions,
  session: AgentSessionHistoryItem
): void {
  const itemEl = containerEl.createDiv({
    attr: {
      role: "button",
      tabindex: "0"
    },
    cls: "agent-dashboard__session-item"
  });
  itemEl.createDiv({
    cls: "agent-dashboard__session-title",
    text: session.title
  });
  itemEl.createDiv({
    cls: "agent-dashboard__session-excerpt",
    text: session.lastMessage || "No messages yet."
  });
  const metaEl = itemEl.createDiv({
    cls: "agent-dashboard__session-meta"
  });
  metaEl.createSpan({ text: formatSessionDate(session.updatedAt) });
  if (session.messageCount !== undefined) {
    metaEl.createSpan({ text: `${session.messageCount} messages` });
  }
  if (session.piSessionId) {
    metaEl.createSpan({ text: session.piSessionId.slice(0, 8) });
  }

  const openSession = (): void => {
    void plugin.openAgentSession(session.name);
    renderDashboardShell(plugin, rootEl, options);
  };

  itemEl.addEventListener("click", openSession);
  itemEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openSession();
  });
}

function getActiveMention(
  promptEl: HTMLTextAreaElement
): { end: number; query: string; start: number } | undefined {
  const cursor = promptEl.selectionStart ?? 0;
  const beforeCursor = promptEl.value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const start = match.index + match[1].length;
  return {
    end: cursor,
    query: match[2],
    start
  };
}

function renderAgentProfileSelector(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  rootEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  const profiles = plugin.getSidekickProfiles();
  const selectedProfile = plugin.getSelectedSidekickProfile();
  const selectorEl = containerEl.createDiv({
    cls: "agent-dashboard__agent-profile-selector"
  });
  const rowEl = selectorEl.createDiv({
    cls: "agent-dashboard__agent-profile-row"
  });
  rowEl.createSpan({
    cls: "agent-dashboard__agent-profile-label",
    text: "Agent"
  });

  const selectEl = rowEl.createEl("select", {
    cls: "agent-dashboard__agent-profile-select"
  });
  const noneOption = selectEl.createEl("option", { text: "No profile" });
  noneOption.value = "";
  for (const profile of profiles) {
    const optionEl = selectEl.createEl("option", { text: profile.name });
    optionEl.value = profile.path;
  }
  selectEl.value = selectedProfile?.path ?? "";
  selectEl.disabled = plugin.agentSessionStatus === "running";
  selectEl.addEventListener("change", async () => {
    await plugin.selectSidekickProfile(selectEl.value);
    renderDashboardShell(plugin, rootEl, options);
  });

  new ButtonComponent(rowEl)
    .setButtonText("Refresh")
    .setTooltip("Reload Sidekick agent profiles")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(async () => {
      await plugin.refreshSidekickProfiles(true);
      renderDashboardShell(plugin, rootEl, options);
    });

  new ButtonComponent(rowEl)
    .setButtonText("Create")
    .setTooltip("Create starter Sidekick agent and memory files")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(async () => {
      await plugin.createSidekickStarterFiles();
      renderDashboardShell(plugin, rootEl, options);
    });

  selectorEl.createDiv({
    cls: "agent-dashboard__agent-profile-meta",
    text: describeAgentProfileSelection(selectedProfile, profiles.length)
  });
}

function describeAgentProfileSelection(
  profile: ReturnType<AgentDashboardPlugin["getSelectedSidekickProfile"]>,
  profileCount: number
): string {
  if (!profile) {
    return profileCount > 0
      ? "Choose a profile or use /agent name as the first line of a prompt."
      : "Create starter profiles under Sidekick/Agents, or add your own .agent.md files.";
  }

  const parts = [];
  if (profile.description) {
    parts.push(profile.description);
  }
  if (profile.modelLabels.length > 0) {
    parts.push(`${profile.modelLabels.length} model choice${profile.modelLabels.length === 1 ? "" : "s"}`);
  }
  if (profile.includePaths.length > 0) {
    parts.push(`${profile.includePaths.length} include${profile.includePaths.length === 1 ? "" : "s"}`);
  }
  if (profile.toolMode) {
    parts.push(profile.toolMode === "read-only" ? "read-only tools" : "tools disabled");
  }

  return parts.join(" · ") || profile.path;
}

function renderModelSelector(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  rootEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  const models = plugin.getSelectablePiModels();
  const selectorEl = containerEl.createDiv({
    cls: "agent-dashboard__model-selector"
  });
  const headerEl = selectorEl.createDiv({
    cls: "agent-dashboard__model-selector-header"
  });
  headerEl.createSpan({
    cls: "agent-dashboard__model-label",
    text: "Model"
  });
  const selectedLabel = getCurrentModelLabel(plugin);
  if (selectedLabel) {
    renderModelBadge(headerEl, selectedLabel, "agent-dashboard__model-current");
  }

  new ButtonComponent(headerEl)
    .setButtonText(models.length === 0 ? "Discover Models" : "Refresh")
    .setTooltip("Discover Pi RPC models")
    .setDisabled(
      plugin.agentSessionStatus === "running" ||
        plugin.piRpcDiscoverySnapshot.status === "checking"
    )
    .onClick(async () => {
      await plugin.refreshPiRpcDiscovery(true);
      renderDashboardShell(plugin, rootEl, options);
    });

  if (models.length === 0) {
    selectorEl.createDiv({
      cls: "agent-dashboard__model-meta",
      text:
        plugin.piRpcDiscoverySnapshot.status === "checking"
          ? "Discovering models..."
          : "Run discovery to show local Pi/Ollama models."
    });
    return;
  }

  const railEl = selectorEl.createDiv({
    cls: "agent-dashboard__model-rail"
  });
  for (const model of models) {
    const modelEl = railEl.createEl("button", {
      cls: "agent-dashboard__model-chip",
      type: "button"
    });
    modelEl.toggleClass("is-selected", model.label === selectedLabel);
    modelEl.setAttr("aria-label", `Select ${model.label}`);
    renderModelBadge(modelEl, model.label, "agent-dashboard__model-chip-icon");
    modelEl.createSpan({
      cls: "agent-dashboard__model-chip-label",
      text: getShortModelLabel(model.label)
    });
    const metaText = describeSelectedModel(plugin, model);
    if (metaText) {
      modelEl.createSpan({
        cls: "agent-dashboard__model-chip-meta",
        text: metaText
      });
    }
    modelEl.addEventListener("click", () => {
      void plugin.selectPiModel(model.label);
    });
  }
}

function renderCurrentAgentProfilePill(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement
): void {
  const profile = plugin.getSelectedSidekickProfile();
  if (!profile) {
    return;
  }

  const pillEl = containerEl.createSpan({
    cls: "agent-dashboard__chat-agent-pill"
  });
  setIcon(pillEl.createSpan({ cls: "agent-dashboard__chat-agent-pill-icon" }), "sparkles");
  pillEl.createSpan({
    cls: "agent-dashboard__chat-agent-pill-label",
    text: profile.name
  });
}

function renderCurrentModelPill(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement
): void {
  const selectedLabel = getCurrentModelLabel(plugin);
  if (!selectedLabel) {
    return;
  }

  renderModelBadge(containerEl, selectedLabel, "agent-dashboard__chat-model-pill");
}

function renderModelBadge(
  containerEl: HTMLElement,
  modelLabel: string,
  className: string
): void {
  const badgeEl = containerEl.createSpan({
    cls: className
  });
  badgeEl.createSpan({
    cls: "agent-dashboard__model-logo",
    text: getModelLogoText(modelLabel)
  });

  if (
    className === "agent-dashboard__model-current" ||
    className === "agent-dashboard__chat-model-pill"
  ) {
    badgeEl.createSpan({
      cls: "agent-dashboard__model-current-label",
      text: getShortModelLabel(modelLabel)
    });
  }
}

function getCurrentModelLabel(plugin: AgentDashboardPlugin): string {
  return (
    plugin.settings.selectedPiModel ||
    plugin.piRpcDiscoverySnapshot.currentModel ||
    ""
  );
}

function getShortModelLabel(modelLabel: string): string {
  return modelLabel.replace(/^ollama\//, "");
}

function getModelLogoText(modelLabel: string): string {
  const label = modelLabel.toLowerCase();
  if (label.includes("deepseek")) {
    return "D";
  }

  if (label.includes("gemma")) {
    return "G";
  }

  if (label.includes("qwen")) {
    return "Q";
  }

  if (label.includes("llama")) {
    return "L";
  }

  if (label.includes("mistral")) {
    return "M";
  }

  return "O";
}

function describeSelectedModel(
  plugin: AgentDashboardPlugin,
  model: PiRpcDiscoverySnapshot["models"][number]
): string {
  const parts = [];

  if (model.contextWindow) {
    parts.push(`${Math.round(model.contextWindow / 1000)}k`);
  }

  if (model.reasoning) {
    parts.push("reasoning");
  }

  for (const capability of getOllamaCapabilitiesForPiModel(plugin, model.label)) {
    if (capability === "tools") {
      parts.push("tools");
    } else if (capability === "vision") {
      parts.push("vision");
    } else if (capability === "thinking" && !parts.includes("reasoning")) {
      parts.push("thinking");
    }
  }

  return parts.join(" · ");
}

function getOllamaCapabilitiesForPiModel(
  plugin: AgentDashboardPlugin,
  modelLabel: string
): string[] {
  const modelName = modelLabel.replace(/^ollama\//, "");
  return (
    plugin.ollamaSnapshot.models.find((model) => model.name === modelName)
      ?.capabilities ?? []
  );
}

function renderApprovalQueue(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  rootEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  const pendingRecords = plugin.getPendingApprovalRecords();
  if (pendingRecords.length === 0) {
    return;
  }

  const queueEl = containerEl.createDiv({
    cls: "agent-dashboard__approval-queue"
  });
  const headingEl = queueEl.createDiv({
    cls: "agent-dashboard__approval-heading"
  });
  headingEl.createSpan({ text: "Approvals" });
  headingEl.createSpan({
    cls: "agent-dashboard__approval-note",
    text: "record only"
  });

  for (const record of pendingRecords) {
    renderApprovalRecord(plugin, queueEl, rootEl, options, record);
  }
}

function renderApprovalRecord(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  rootEl: HTMLElement,
  options: DashboardRenderOptions,
  record: ApprovalRecord
): void {
  const cardEl = containerEl.createDiv({ cls: "agent-dashboard__approval-card" });
  const titleEl = cardEl.createDiv({ cls: "agent-dashboard__approval-title" });
  titleEl.createSpan({ text: getApprovalTitle(record) });
  titleEl.createSpan({
    cls: "agent-dashboard__approval-kind",
    text: record.decision.request.kind
  });

  cardEl.createDiv({
    cls: "agent-dashboard__approval-reason",
    text: record.decision.reason
  });

  const detail = getApprovalDetail(record);
  if (detail) {
    cardEl.createDiv({
      cls: "agent-dashboard__approval-detail",
      text: detail
    });
  }

  cardEl.createDiv({
    cls: "agent-dashboard__approval-note",
    text: record.note
  });

  const actionsEl = cardEl.createDiv({
    cls: "agent-dashboard__approval-actions"
  });
  new ButtonComponent(actionsEl)
    .setButtonText("Approve")
    .setTooltip("Record approval without executing")
    .onClick(() => {
      plugin.approveRequest(record.id);
      renderDashboardShell(plugin, rootEl, options);
    });

  new ButtonComponent(actionsEl)
    .setButtonText("Deny")
    .setTooltip("Deny request")
    .onClick(() => {
      plugin.denyRequest(record.id);
      renderDashboardShell(plugin, rootEl, options);
    });
}

function getApprovalTitle(record: ApprovalRecord): string {
  return record.decision.request.description || "Approval request";
}

function getApprovalDetail(record: ApprovalRecord): string {
  const request = record.decision.request;

  if (request.command) {
    return request.command;
  }

  if (request.targetPath) {
    return request.targetPath;
  }

  return "";
}

function renderAgentEvent(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  event: AgentEvent
): void {
  if (event.kind === "status") {
    renderStatusLogLine(containerEl, event);
    return;
  }

  if (event.kind === "tool") {
    renderToolEvent(plugin, containerEl, event);
    return;
  }

  const eventEl = containerEl.createDiv({
    cls: `agent-dashboard__event agent-dashboard__event--${event.kind}`
  });
  const metaEl = eventEl.createDiv({ cls: "agent-dashboard__event-meta" });
  const labelEl = metaEl.createSpan({ cls: "agent-dashboard__event-label" });
  const iconEl = labelEl.createSpan({ cls: "agent-dashboard__event-icon" });
  setIcon(iconEl, getAgentEventIcon(event));
  labelEl.createSpan({ text: getAgentEventLabel(event) });

  metaEl.createSpan({
    cls: "agent-dashboard__event-time",
    text: formatEventTime(event.createdAt)
  });

  const textEl = eventEl.createDiv({
    cls: "agent-dashboard__event-text markdown-rendered"
  });
  void MarkdownRenderer.render(
    plugin.app,
    event.text,
    textEl,
    plugin.app.workspace.getActiveFile()?.path ?? "",
    plugin
  ).then(() => {
    linkInlineReferencedFiles(plugin, textEl);
  });
  renderReferencedFiles(plugin, eventEl, event.text);
  renderProposedEdits(plugin, eventEl, event.id);
}

function renderToolEvent(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  event: AgentEvent
): void {
  const tool = event.tool ?? inferToolEvent(event.text);
  const cardEl = containerEl.createEl("details", {
    cls: `agent-dashboard__tool-card agent-dashboard__tool-card--${tool.status}`
  });
  const summaryEl = cardEl.createEl("summary", {
    cls: "agent-dashboard__tool-header"
  });
  const titleEl = summaryEl.createDiv({
    cls: "agent-dashboard__tool-title"
  });
  const iconEl = titleEl.createSpan({
    cls: "agent-dashboard__tool-icon"
  });
  setIcon(iconEl, getToolStatusIcon(tool));
  titleEl.createSpan({ text: `Tool used: ${getToolDisplayName(tool)}` });

  const summaryMetaEl = summaryEl.createSpan({
    cls: "agent-dashboard__tool-summary-meta"
  });
  summaryMetaEl.createSpan({
    cls: "agent-dashboard__tool-status",
    text: tool.status
  });
  summaryMetaEl.createSpan({
    cls: "agent-dashboard__tool-time",
    text: formatEventTime(event.createdAt)
  });

  const bodyEl = cardEl.createDiv({
    cls: "agent-dashboard__tool-content"
  });
  const metaItems = [
    tool.title ? `title: ${tool.title}` : "",
    tool.name ? `name: ${tool.name}` : "",
    tool.callId ? `id: ${tool.callId}` : "",
    tool.eventType ? `event: ${tool.eventType}` : ""
  ].filter(Boolean);
  if (metaItems.length > 0) {
    bodyEl.createDiv({
      cls: "agent-dashboard__tool-meta",
      text: metaItems.join(" · ")
    });
  }

  if (tool.input !== undefined) {
    renderToolPayload(bodyEl, "Input", tool.input);
  }

  if (tool.output !== undefined) {
    renderToolPayload(bodyEl, tool.status === "error" ? "Error" : "Output", tool.output);
  }

  if (tool.input === undefined && tool.output === undefined) {
    const textEl = bodyEl.createDiv({
      cls: "agent-dashboard__tool-text markdown-rendered"
    });
    void MarkdownRenderer.render(
      plugin.app,
      event.text,
      textEl,
      plugin.app.workspace.getActiveFile()?.path ?? "",
      plugin
    ).then(() => {
      linkInlineReferencedFiles(plugin, textEl);
    });
  }

  renderReferencedFiles(plugin, bodyEl, event.text);
}

function getToolDisplayName(tool: AgentToolEvent): string {
  return tool.name || tool.title || tool.eventType || "tool";
}

function renderToolPayload(
  containerEl: HTMLElement,
  label: string,
  value: unknown
): void {
  const sectionEl = containerEl.createDiv({
    cls: "agent-dashboard__tool-payload"
  });
  sectionEl.createDiv({
    cls: "agent-dashboard__tool-payload-label",
    text: label
  });
  sectionEl.createEl("pre", {
    cls: "agent-dashboard__tool-payload-body",
    text: formatToolPayload(value)
  });
}

function inferToolEvent(text: string): AgentToolEvent {
  const lower = text.toLowerCase();
  const blocked = lower.includes("blocked") || lower.includes("denied");
  const allowed = lower.includes("allowed") || lower.includes("added ");
  const failed = lower.includes("failed") || lower.includes("error");
  const unexpected = text.match(/Unexpected tool event in no-tools mode: ([\w-]+)/i);
  const check = text.match(/^([^:]+ check):\s*([^-]+)(?:-\s*(.+))?$/i);

  if (unexpected) {
    return {
      eventType: unexpected[1],
      status: "blocked",
      title: `Blocked ${unexpected[1].replace(/_/g, " ")}`
    };
  }

  if (check) {
    return {
      eventType: "safety_check",
      output: check[3]?.trim(),
      status: blocked ? "blocked" : failed ? "error" : "info",
      title: `${check[1]} ${check[2].trim()}`
    };
  }

  return {
    eventType: "dashboard_tool_event",
    status: blocked ? "blocked" : failed ? "error" : allowed ? "result" : "info",
    title: text.split("\n")[0] || "Tool event"
  };
}

function formatToolPayload(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getToolStatusIcon(tool: AgentToolEvent): string {
  if (tool.status === "blocked") {
    return "shield-alert";
  }

  if (tool.status === "error") {
    return "circle-alert";
  }

  if (tool.status === "result") {
    return "check-circle";
  }

  return "wrench";
}

function renderStatusLogLine(
  containerEl: HTMLElement,
  event: AgentEvent
): void {
  const logEl = containerEl.createDiv({
    cls: "agent-dashboard__status-log-line"
  });
  const iconEl = logEl.createSpan({
    cls: "agent-dashboard__status-log-icon"
  });
  setIcon(iconEl, "activity");
  logEl.createSpan({
    cls: "agent-dashboard__status-log-text",
    text: event.text
  });
  logEl.createSpan({
    cls: "agent-dashboard__status-log-time",
    text: formatEventTime(event.createdAt)
  });
}

function renderProposedEdits(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  eventId: string
): void {
  const proposedEdits = plugin.getProposedEditsForEvent(eventId);
  if (proposedEdits.length === 0) {
    return;
  }

  const editsEl = containerEl.createDiv({
    cls: "agent-dashboard__proposed-edits"
  });

  for (const proposedEdit of proposedEdits) {
    renderProposedEdit(plugin, editsEl, proposedEdit);
  }
}

function renderProposedEdit(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  proposedEdit: ProposedEditRecord
): void {
  const cardEl = containerEl.createDiv({
    cls: "agent-dashboard__proposed-edit"
  });
  const headerEl = cardEl.createDiv({
    cls: "agent-dashboard__proposed-edit-header"
  });
  const titleEl = headerEl.createDiv({
    cls: "agent-dashboard__proposed-edit-title"
  });
  titleEl.createSpan({ text: "Proposed edit" });
  titleEl.createSpan({
    cls: "agent-dashboard__proposed-edit-path",
    text: proposedEdit.path
  });

  const metaEl = headerEl.createDiv({
    cls: "agent-dashboard__proposed-edit-meta"
  });
  metaEl.createSpan({
    text: proposedEdit.fileExists ? "existing file" : "new file"
  });
  metaEl.createSpan({ text: describeProposedEditStatus(proposedEdit) });

  if (proposedEdit.applyError) {
    cardEl.createDiv({
      cls: "agent-dashboard__proposed-edit-error",
      text: proposedEdit.applyError
    });
  }

  const diffEl = cardEl.createDiv({
    cls: "agent-dashboard__diff"
  });
  for (const line of proposedEdit.diffLines) {
    renderDiffLine(diffEl, line);
  }

  const actionsEl = cardEl.createDiv({
    cls: "agent-dashboard__proposed-edit-actions"
  });
  new ButtonComponent(actionsEl)
    .setButtonText("Open")
    .setTooltip("Open target note")
    .setDisabled(!proposedEdit.fileExists)
    .onClick(() => {
      void plugin.openVaultFilePath(proposedEdit.path);
    });

  const applyState = getProposedEditApplyState(proposedEdit);
  new ButtonComponent(actionsEl)
    .setButtonText(applyState.label)
    .setTooltip(applyState.tooltip)
    .setDisabled(!applyState.enabled)
    .onClick(() => {
      void plugin.applyProposedEdit(proposedEdit.id);
    });
}

function describeProposedEditStatus(proposedEdit: ProposedEditRecord): string {
  if (proposedEdit.status === "apply-error") {
    return "blocked";
  }

  return proposedEdit.status.replace("-", " ");
}

function getProposedEditApplyState(
  proposedEdit: ProposedEditRecord
): { enabled: boolean; label: string; tooltip: string } {
  if (proposedEdit.status === "approved") {
    return {
      enabled: true,
      label: "Apply",
      tooltip: "Apply approved edit through Obsidian vault APIs"
    };
  }

  if (proposedEdit.status === "applied") {
    return {
      enabled: false,
      label: "Applied",
      tooltip: "This edit has already been applied"
    };
  }

  if (proposedEdit.status === "denied") {
    return {
      enabled: false,
      label: "Denied",
      tooltip: "This edit was denied"
    };
  }

  if (proposedEdit.status === "apply-error") {
    return {
      enabled: false,
      label: "Blocked",
      tooltip: proposedEdit.applyError || "This edit cannot be applied"
    };
  }

  return {
    enabled: false,
    label: "Approve first",
    tooltip: "Approve the queued write request before applying"
  };
}

function renderDiffLine(
  containerEl: HTMLElement,
  line: ProposedEditDiffLine
): void {
  const lineEl = containerEl.createDiv({
    cls: `agent-dashboard__diff-line agent-dashboard__diff-line--${line.kind}`
  });
  lineEl.createSpan({
    cls: "agent-dashboard__diff-old-line",
    text: line.oldLineNumber ? String(line.oldLineNumber) : ""
  });
  lineEl.createSpan({
    cls: "agent-dashboard__diff-new-line",
    text: line.newLineNumber ? String(line.newLineNumber) : ""
  });
  lineEl.createSpan({
    cls: "agent-dashboard__diff-marker",
    text: getDiffMarker(line)
  });
  lineEl.createSpan({
    cls: "agent-dashboard__diff-text",
    text: line.text || " "
  });
}

function getDiffMarker(line: ProposedEditDiffLine): string {
  if (line.kind === "added") {
    return "+";
  }

  if (line.kind === "removed") {
    return "-";
  }

  return " ";
}

function linkInlineReferencedFiles(
  plugin: AgentDashboardPlugin,
  rootEl: HTMLElement
): void {
  const candidates = getInlineFileReferenceCandidates(plugin);
  if (candidates.length === 0) {
    return;
  }

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(
    rootEl,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.textContent?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        return isInlineLinkableTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    replaceInlineFileReferences(plugin, textNode, candidates);
  }
}

function getInlineFileReferenceCandidates(
  plugin: AgentDashboardPlugin
): { file: TFile; text: string }[] {
  return plugin.app.vault.getMarkdownFiles()
    .flatMap((file) => {
      const candidates = [{ file, text: file.path }];
      const withoutExtension = file.path.replace(/\.md$/i, "");
      if (withoutExtension !== file.path && withoutExtension.includes("/")) {
        candidates.push({ file, text: withoutExtension });
      }

      return candidates;
    })
    .sort((a, b) => b.text.length - a.text.length);
}

function isInlineLinkableTextNode(node: Node): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (
      [
        "A",
        "BUTTON",
        "CODE",
        "MJX-CONTAINER",
        "PRE",
        "SCRIPT",
        "STYLE",
        "TEXTAREA"
      ].includes(parent.tagName)
    ) {
      return false;
    }

    parent = parent.parentElement;
  }

  return true;
}

function replaceInlineFileReferences(
  plugin: AgentDashboardPlugin,
  textNode: Text,
  candidates: { file: TFile; text: string }[]
): void {
  const text = textNode.textContent ?? "";
  const fragment = textNode.ownerDocument.createDocumentFragment();
  let offset = 0;
  let changed = false;

  while (offset < text.length) {
    const match = findNextInlineFileReference(text, offset, candidates);
    if (!match) {
      break;
    }

    if (match.index > offset) {
      fragment.append(text.slice(offset, match.index));
    }

    const linkEl = textNode.ownerDocument.createElement("a");
    linkEl.addClass("agent-dashboard__inline-file-link");
    linkEl.href = "#";
    linkEl.textContent = text.slice(match.index, match.index + match.length);
    linkEl.addEventListener("click", (event) => {
      event.preventDefault();
      void plugin.app.workspace.getLeaf(false).openFile(match.file);
    });
    fragment.append(linkEl);
    offset = match.index + match.length;
    changed = true;
  }

  if (!changed) {
    return;
  }

  if (offset < text.length) {
    fragment.append(text.slice(offset));
  }

  textNode.replaceWith(fragment);
}

function findNextInlineFileReference(
  text: string,
  offset: number,
  candidates: { file: TFile; text: string }[]
): { file: TFile; index: number; length: number } | undefined {
  let bestMatch: { file: TFile; index: number; length: number } | undefined;

  for (const candidate of candidates) {
    let index = text.indexOf(candidate.text, offset);
    while (index !== -1) {
      const end = index + candidate.text.length;
      if (isInlineFileReferenceBoundary(text, index, end)) {
        if (
          !bestMatch ||
          index < bestMatch.index ||
          (index === bestMatch.index && candidate.text.length > bestMatch.length)
        ) {
          bestMatch = {
            file: candidate.file,
            index,
            length: candidate.text.length
          };
        }
        break;
      }

      index = text.indexOf(candidate.text, index + 1);
    }
  }

  return bestMatch;
}

function isInlineFileReferenceBoundary(
  text: string,
  start: number,
  end: number
): boolean {
  const before = text[start - 1];
  const after = text[end];
  const validBefore = before === undefined || /[\s"'`([{:@]/.test(before);
  const validAfter = after === undefined || /[\s"'`),.;:!?}\]]/.test(after);

  return validBefore && validAfter;
}

function renderReferencedFiles(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  text: string
): void {
  const referencedFiles = findReferencedVaultFiles(plugin, text);
  if (referencedFiles.length === 0) {
    return;
  }

  const filesEl = containerEl.createDiv({
    cls: "agent-dashboard__referenced-files"
  });
  filesEl.createSpan({
    cls: "agent-dashboard__referenced-label",
    text: "Files"
  });

  for (const file of referencedFiles) {
    const fileEl = filesEl.createEl("button", {
      cls: "agent-dashboard__referenced-file",
      text: file.path,
      type: "button"
    });
    fileEl.addEventListener("click", async () => {
      await plugin.app.workspace.getLeaf(false).openFile(file);
    });
  }
}

function findReferencedVaultFiles(
  plugin: AgentDashboardPlugin,
  text: string
): TFile[] {
  const files = plugin.app.vault.getMarkdownFiles();
  const matches: TFile[] = [];

  for (const file of files) {
    if (isFilePathMentioned(text, file.path) && !matches.includes(file)) {
      matches.push(file);
    }
  }

  return matches.slice(0, 8);
}

function isFilePathMentioned(text: string, filePath: string): boolean {
  if (text.includes(filePath)) {
    return true;
  }

  const withoutExtension = filePath.replace(/\.md$/i, "");
  return withoutExtension !== filePath && text.includes(withoutExtension);
}

function getAgentEventLabel(event: AgentEvent): string {
  if (event.kind === "user") {
    return "You";
  }

  if (event.kind === "assistant") {
    return "Agent";
  }

  if (event.kind === "tool") {
    return "Tool";
  }

  return "Status";
}

function getAgentEventIcon(event: AgentEvent): string {
  if (event.kind === "user") {
    return "user";
  }

  if (event.kind === "assistant") {
    return "bot";
  }

  if (event.kind === "tool") {
    return "wrench";
  }

  return "activity";
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSessionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString([], {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  });
}

function renderStatusItem(
  containerEl: HTMLElement,
  label: string,
  value: string
): void {
  const itemEl = containerEl.createDiv({ cls: "agent-dashboard__status-item" });
  itemEl.createSpan({ cls: "agent-dashboard__status-label", text: label });
  itemEl.createSpan({ cls: "agent-dashboard__status-value", text: value });
}

function describeDashboard(
  plugin: AgentDashboardPlugin,
  options: DashboardRenderOptions
): string {
  const model = options.model || plugin.settings.defaultModel;
  const workspace = options.workspace ?? "vault";

  if (model) {
    return `${workspace} workspace using ${model}`;
  }

  return `${workspace} workspace. Configure an Ollama model when ready.`;
}
