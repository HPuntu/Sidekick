import { ButtonComponent, Notice, setIcon } from "obsidian";

import type AgentDashboardPlugin from "../main";
import type { AgentEvent } from "../agent/AgentSession";
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
  titleWrapEl.createEl("h3", { text: "Agent Dashboard" });
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
  renderStatusPanel(plugin, bodyEl, options);
  renderAgentPanel(plugin, bodyEl, options);
}

function renderStatusPanel(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  const panelEl = containerEl.createDiv({
    cls: "agent-dashboard__panel agent-dashboard__panel--status"
  });
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
  renderStatusItem(listEl, "Workspace", options.workspace ?? "vault");
  renderStatusItem(listEl, "Session", options.session ?? "default");
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
}

function describePiRpcReady(snapshot: PiRpcDiscoverySnapshot): string {
  const commandCount = snapshot.commandCount ?? 0;
  const responseCount = snapshot.responseCount ?? 0;
  return `ready (${responseCount}/${commandCount} discovery responses)`;
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

function renderAgentPanel(
  plugin: AgentDashboardPlugin,
  containerEl: HTMLElement,
  options: DashboardRenderOptions
): void {
  const panelEl = containerEl.createDiv({
    cls: "agent-dashboard__panel agent-dashboard__panel--agent"
  });
  const headingEl = panelEl.createDiv({ cls: "agent-dashboard__panel-heading" });
  headingEl.createEl("h4", { text: "Agent" });

  const rootEl = containerEl.parentElement ?? containerEl;
  const controlsEl = headingEl.createDiv({
    cls: "agent-dashboard__panel-controls"
  });

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

  renderApprovalQueue(plugin, panelEl, rootEl, options);

  const streamEl = panelEl.createDiv({ cls: "agent-dashboard__event-stream" });
  if (plugin.agentEvents.length === 0) {
    streamEl.createEl("p", {
      cls: "agent-dashboard__empty",
      text: "No agent events yet."
    });
  } else {
    for (const event of plugin.agentEvents) {
      renderAgentEvent(streamEl, event);
    }
    streamEl.scrollTop = streamEl.scrollHeight;
  }

  const composerEl = panelEl.createDiv({ cls: "agent-dashboard__composer" });
  const promptEl = composerEl.createEl("textarea", {
    cls: "agent-dashboard__prompt-input",
    attr: {
      placeholder: "Ask the agent...",
      rows: "3"
    }
  });
  promptEl.disabled = plugin.agentSessionStatus === "running";
  promptEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendPrompt();
    }
  });

  const composerActionsEl = composerEl.createDiv({
    cls: "agent-dashboard__composer-actions"
  });
  new ButtonComponent(composerActionsEl)
    .setButtonText(plugin.agentSessionStatus === "running" ? "Running" : "Send")
    .setTooltip("Send prompt")
    .setDisabled(plugin.agentSessionStatus === "running")
    .onClick(() => {
      sendPrompt();
    });

  function sendPrompt(): void {
    const accepted = plugin.sendAgentPrompt(promptEl.value);
    if (!accepted) {
      return;
    }

    promptEl.value = "";
    renderDashboardShell(plugin, rootEl, options);
  }
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

function renderAgentEvent(containerEl: HTMLElement, event: AgentEvent): void {
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
  eventEl.createDiv({
    cls: "agent-dashboard__event-text",
    text: event.text
  });
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
