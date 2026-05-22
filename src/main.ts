import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf } from "obsidian";

import {
  AgentEvent,
  AgentEventKind,
  AgentSessionStatus,
  createAgentEvent
} from "./agent/AgentSession";
import { BridgeService } from "./bridge/BridgeService";
import {
  createCheckingOllamaSnapshot,
  createUnknownOllamaSnapshot,
  OllamaSnapshot
} from "./bridge/ollama/OllamaClient";
import {
  createCheckingPiSnapshot,
  createUnknownPiSnapshot,
  PiSnapshot
} from "./bridge/pi/PiProbe";
import {
  createCheckingPiRpcDiscoverySnapshot,
  createUnknownPiRpcDiscoverySnapshot,
  PiRpcDiscoverySnapshot
} from "./bridge/pi/PiRpcDiscovery";
import { registerAgentDashboardBlock } from "./markdown/agentDashboardBlock";
import {
  ApprovalRecord,
  countPendingApprovals,
  createApprovalRecord
} from "./security/ApprovalQueue";
import {
  assessSafetyRequest,
  parseExternalRoots,
  SafetyDecision,
  SafetyRequest,
  SafetySnapshot,
  summarizeAllowedRoots
} from "./security/SafetyPolicy";
import {
  AgentDashboardSettingTab,
  AgentDashboardSettings,
  DEFAULT_SETTINGS
} from "./settings";
import {
  AGENT_DASHBOARD_VIEW_TYPE,
  AgentDashboardView
} from "./views/AgentDashboardView";

export default class AgentDashboardPlugin extends Plugin {
  agentEvents: AgentEvent[] = [];
  agentSessionStatus: AgentSessionStatus = "idle";
  approvalRecords: ApprovalRecord[] = [];
  bridge: BridgeService;
  lastSafetyDecision?: SafetyDecision;
  ollamaSnapshot: OllamaSnapshot = createUnknownOllamaSnapshot(
    DEFAULT_SETTINGS.ollamaHost
  );
  piSnapshot: PiSnapshot = createUnknownPiSnapshot(
    DEFAULT_SETTINGS.piExecutablePath
  );
  piRpcDiscoverySnapshot: PiRpcDiscoverySnapshot =
    createUnknownPiRpcDiscoverySnapshot(DEFAULT_SETTINGS.piExecutablePath);
  safetyAuditLog: SafetyDecision[] = [];
  settings: AgentDashboardSettings = DEFAULT_SETTINGS;
  private agentEventCounter = 0;
  private approvalCounter = 0;
  private mockRunTimer?: number;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.bridge = new BridgeService(this.manifest.version);
    this.ollamaSnapshot = createUnknownOllamaSnapshot(this.settings.ollamaHost);
    this.piSnapshot = createUnknownPiSnapshot(this.settings.piExecutablePath);
    this.piRpcDiscoverySnapshot = createUnknownPiRpcDiscoverySnapshot(
      this.settings.piExecutablePath
    );

    if (this.settings.autoStartBridge) {
      const snapshot = await this.bridge.start();
      if (snapshot.status === "error") {
        new Notice(`Agent Dashboard bridge failed: ${snapshot.error}`);
      }
    }

    this.addAgentEvent(
      "status",
      "Agent shell ready in read-only mode. Shell commands and file writes are blocked."
    );

    this.registerView(
      AGENT_DASHBOARD_VIEW_TYPE,
      (leaf) => new AgentDashboardView(leaf, this)
    );

    registerAgentDashboardBlock(this);
    this.addSettingTab(new AgentDashboardSettingTab(this.app, this));

    this.addRibbonIcon("bot", "Open Agent Dashboard", async () => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-agent-dashboard",
      name: "Open agent dashboard",
      callback: async () => {
        await this.activateView();
      }
    });

    this.addCommand({
      id: "insert-agent-dashboard-block",
      name: "Insert agent dashboard block",
      editorCallback: (editor) => {
        editor.replaceSelection(
          [
            "```agent-dashboard",
            "workspace: vault",
            "mode: compact",
            "session: default",
            "```"
          ].join("\n")
        );
      }
    });

    this.addCommand({
      id: "restart-agent-dashboard-bridge",
      name: "Restart agent dashboard bridge",
      callback: async () => {
        const snapshot = await this.bridge.restart();
        this.showBridgeNotice(snapshot.status);
        this.refreshDashboardViews();
      }
    });

    this.addCommand({
      id: "stop-agent-dashboard-bridge",
      name: "Stop agent dashboard bridge",
      callback: async () => {
        const snapshot = await this.bridge.stop();
        this.showBridgeNotice(snapshot.status);
        this.refreshDashboardViews();
      }
    });

    this.addCommand({
      id: "check-ollama-status",
      name: "Check Ollama status",
      callback: async () => {
        await this.refreshOllamaStatus(true);
      }
    });

    this.addCommand({
      id: "check-pi-executable",
      name: "Check Pi executable",
      callback: async () => {
        await this.refreshPiStatus(true);
      }
    });

    this.addCommand({
      id: "discover-pi-rpc",
      name: "Discover Pi RPC",
      callback: async () => {
        await this.refreshPiRpcDiscovery(true);
      }
    });

    this.addCommand({
      id: "stop-agent-run",
      name: "Stop agent run",
      callback: () => {
        this.stopAgentRun();
      }
    });

    this.addCommand({
      id: "clear-agent-events",
      name: "Clear agent events",
      callback: () => {
        this.clearAgentEvents();
      }
    });

    this.addCommand({
      id: "run-agent-safety-self-check",
      name: "Run agent safety self-check",
      callback: () => {
        this.runSafetySelfCheck();
      }
    });

    this.addCommand({
      id: "create-sample-approval-request",
      name: "Create sample approval request",
      callback: () => {
        this.createSampleApprovalRequest();
      }
    });

    void this.refreshOllamaStatus(false);

    new Notice("Agent Dashboard loaded");
  }

  async onunload(): Promise<void> {
    if (this.mockRunTimer !== undefined) {
      window.clearTimeout(this.mockRunTimer);
    }

    await this.bridge.stop();
    this.app.workspace.detachLeavesOfType(AGENT_DASHBOARD_VIEW_TYPE);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(AGENT_DASHBOARD_VIEW_TYPE)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        leaf = workspace.getLeaf(true);
      }

      if (!leaf) {
        new Notice("Unable to open Agent Dashboard");
        return;
      }

      await leaf.setViewState({
        type: AGENT_DASHBOARD_VIEW_TYPE,
        active: true
      });
    }

    workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  resetOllamaStatus(): void {
    this.ollamaSnapshot = createUnknownOllamaSnapshot(this.settings.ollamaHost);
    this.refreshDashboardViews();
  }

  resetPiStatus(): void {
    this.piSnapshot = createUnknownPiSnapshot(this.settings.piExecutablePath);
    this.piRpcDiscoverySnapshot = createUnknownPiRpcDiscoverySnapshot(
      this.settings.piExecutablePath
    );
    this.refreshDashboardViews();
  }

  async refreshOllamaStatus(showNotice: boolean): Promise<void> {
    this.ollamaSnapshot = createCheckingOllamaSnapshot(this.settings.ollamaHost);
    this.refreshDashboardViews();

    this.ollamaSnapshot = await this.bridge.checkOllama(
      this.settings.ollamaHost,
      this.settings.defaultModel
    );
    this.refreshDashboardViews();

    if (!showNotice) {
      return;
    }

    if (this.ollamaSnapshot.status === "running") {
      new Notice(
        `Ollama reachable: ${this.ollamaSnapshot.models.length} model(s) found`
      );
      return;
    }

    new Notice(`Ollama unreachable: ${this.ollamaSnapshot.error}`);
  }

  async refreshPiStatus(showNotice: boolean): Promise<void> {
    this.assessSafetyRequest({
      kind: "diagnostic",
      command: `${this.settings.piExecutablePath} --version`,
      description: "Check Pi executable"
    });
    this.piSnapshot = createCheckingPiSnapshot(this.settings.piExecutablePath);
    this.refreshDashboardViews();

    this.piSnapshot = await this.bridge.probePiExecutable(
      this.settings.piExecutablePath
    );
    this.refreshDashboardViews();

    if (!showNotice) {
      return;
    }

    if (this.piSnapshot.status === "available") {
      new Notice(`Pi executable available: ${this.piSnapshot.version}`);
      return;
    }

    new Notice(`Pi executable unavailable: ${this.piSnapshot.error}`);
  }

  async refreshPiRpcDiscovery(showNotice: boolean): Promise<void> {
    this.assessSafetyRequest({
      kind: "diagnostic",
      command: `${this.settings.piExecutablePath} --mode rpc --no-session`,
      description: "Discover Pi RPC readiness"
    });
    this.piRpcDiscoverySnapshot = createCheckingPiRpcDiscoverySnapshot(
      this.settings.piExecutablePath
    );
    this.refreshDashboardViews();

    this.piRpcDiscoverySnapshot = await this.bridge.discoverPiRpc(
      this.settings.piExecutablePath
    );
    this.refreshDashboardViews();

    if (!showNotice) {
      return;
    }

    if (this.piRpcDiscoverySnapshot.status === "ready") {
      new Notice("Pi RPC discovery ready");
      return;
    }

    new Notice(`Pi RPC discovery failed: ${this.piRpcDiscoverySnapshot.error}`);
  }

  sendAgentPrompt(prompt: string): boolean {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      new Notice("Enter a prompt first");
      return false;
    }

    if (this.agentSessionStatus === "running") {
      new Notice("Agent is already running");
      return false;
    }

    this.addAgentEvent("user", trimmedPrompt);
    this.agentSessionStatus = "running";
    const piDecision = this.assessSafetyRequest({
      kind: "shell",
      command: `${this.settings.piExecutablePath} --mode rpc`,
      description: "Start Pi RPC session"
    });
    this.enqueueApproval(piDecision);
    this.addAgentEvent(
      "tool",
      `Safety guard queued Pi session approval: ${piDecision.reason}`
    );
    this.addAgentEvent("status", "Mock read-only agent run started.");
    this.refreshDashboardViews();

    this.mockRunTimer = window.setTimeout(() => {
      this.mockRunTimer = undefined;
      this.addAgentEvent("assistant", this.createMockAgentReply(trimmedPrompt));
      this.agentSessionStatus = "idle";
      this.addAgentEvent(
        "status",
        "Mock run complete. Pi RPC streaming will be enabled after approval gates are implemented."
      );
      this.refreshDashboardViews();
    }, 800);

    return true;
  }

  stopAgentRun(): void {
    if (this.mockRunTimer !== undefined) {
      window.clearTimeout(this.mockRunTimer);
      this.mockRunTimer = undefined;
    }

    if (this.agentSessionStatus === "running") {
      this.agentSessionStatus = "idle";
      this.addAgentEvent("status", "Mock agent run stopped.");
      this.refreshDashboardViews();
    }
  }

  clearAgentEvents(): void {
    this.agentEvents = [];
    this.addAgentEvent("status", "Agent event stream cleared.");
    this.refreshDashboardViews();
  }

  assessSafetyRequest(request: SafetyRequest): SafetyDecision {
    const decision = assessSafetyRequest(this.getSafetySnapshot(), request);
    this.lastSafetyDecision = decision;
    this.safetyAuditLog.push(decision);

    if (this.safetyAuditLog.length > 100) {
      this.safetyAuditLog = this.safetyAuditLog.slice(-100);
    }

    return decision;
  }

  approveRequest(id: string): void {
    const record = this.approvalRecords.find((item) => item.id === id);
    if (!record || record.status !== "pending") {
      return;
    }

    record.status = "approved";
    record.decidedAt = new Date().toISOString();
    record.note =
      "Approval recorded only. Read-only mode still prevents execution.";
    this.addAgentEvent(
      "tool",
      `Approval recorded for ${describeSafetyRequest(record.decision.request)}. Execution remains disabled.`
    );
    this.refreshDashboardViews();
  }

  denyRequest(id: string): void {
    const record = this.approvalRecords.find((item) => item.id === id);
    if (!record || record.status !== "pending") {
      return;
    }

    record.status = "denied";
    record.decidedAt = new Date().toISOString();
    record.note = "Denied by user.";
    this.addAgentEvent(
      "tool",
      `Approval denied for ${describeSafetyRequest(record.decision.request)}.`
    );
    this.refreshDashboardViews();
  }

  getSafetySnapshot(): SafetySnapshot {
    const vaultRoot = this.getVaultRoot();
    const externalRoots = parseExternalRoots(
      this.settings.allowedExternalWorkspaceRoots
    );
    const allowedRoots = [...(vaultRoot ? [vaultRoot] : []), ...externalRoots];

    return {
      allowedRoots,
      mode: "read-only",
      pendingApprovals: countPendingApprovals(this.approvalRecords),
      vaultRoot
    };
  }

  getPendingApprovalRecords(): ApprovalRecord[] {
    return this.approvalRecords.filter((record) => record.status === "pending");
  }

  runSafetySelfCheck(): void {
    const snapshot = this.getSafetySnapshot();
    const rootsSummary = summarizeAllowedRoots(snapshot);
    this.addAgentEvent("status", `Safety self-check: ${rootsSummary}.`);

    if (snapshot.vaultRoot) {
      const readDecision = this.assessSafetyRequest({
        kind: "read",
        targetPath: snapshot.vaultRoot,
        description: "Read vault root"
      });
      this.addAgentEvent(
        "tool",
        `Read check: ${readDecision.allowed ? "allowed" : "blocked"} - ${readDecision.reason}`
      );
    }

    const shellDecision = this.assessSafetyRequest({
      kind: "shell",
      command: "pwd",
      description: "Example shell command"
    });
    this.enqueueApproval(shellDecision);
    this.addAgentEvent("tool", `Shell check: blocked - ${shellDecision.reason}`);

    const writeDecision = this.assessSafetyRequest({
      kind: "write",
      targetPath: snapshot.vaultRoot,
      description: "Example file write"
    });
    this.enqueueApproval(writeDecision);
    this.addAgentEvent("tool", `Write check: blocked - ${writeDecision.reason}`);
    this.refreshDashboardViews();
  }

  refreshDashboardViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(
      AGENT_DASHBOARD_VIEW_TYPE
    )) {
      if (leaf.view instanceof AgentDashboardView) {
        leaf.view.render();
      }
    }
  }

  private showBridgeNotice(status: string): void {
    const snapshot = this.bridge.getSnapshot();
    if (status === "running" && snapshot.url) {
      new Notice(`Agent Dashboard bridge running on ${snapshot.url}`);
      return;
    }

    new Notice(`Agent Dashboard bridge ${status}`);
  }

  private getVaultRoot(): string | undefined {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }

    return undefined;
  }

  private addAgentEvent(kind: AgentEventKind, text: string): void {
    this.agentEventCounter += 1;
    this.agentEvents.push(
      createAgentEvent(`agent-event-${this.agentEventCounter}`, kind, text)
    );

    if (this.agentEvents.length > 60) {
      this.agentEvents = this.agentEvents.slice(-60);
    }
  }

  private enqueueApproval(decision: SafetyDecision): ApprovalRecord {
    this.approvalCounter += 1;
    const record = createApprovalRecord(
      `approval-${this.approvalCounter}`,
      decision
    );
    this.approvalRecords.unshift(record);

    if (this.approvalRecords.length > 40) {
      this.approvalRecords = this.approvalRecords.slice(0, 40);
    }

    return record;
  }

  private createMockAgentReply(prompt: string): string {
    const model = this.settings.defaultModel || "the selected local model";
    return [
      `Mock response for: ${prompt}`,
      "",
      `Next stage will send this prompt to Pi using ${model}.`,
      "For now, this confirms the sidebar event stream, controls, and rendering loop work."
    ].join("\n");
  }

  private createSampleApprovalRequest(): void {
    const decision = this.assessSafetyRequest({
      kind: "shell",
      command: "echo sample",
      description: "Sample approval queue request"
    });
    this.enqueueApproval(decision);
    this.addAgentEvent(
      "tool",
      "Sample approval request queued. Approve/deny only records a decision."
    );
    this.refreshDashboardViews();
  }
}

function describeSafetyRequest(request: SafetyRequest): string {
  if (request.description) {
    return request.description;
  }

  if (request.command) {
    return request.command;
  }

  if (request.targetPath) {
    return request.targetPath;
  }

  return request.kind;
}
