import {
  App,
  ButtonComponent,
  FileSystemAdapter,
  MarkdownFileInfo,
  Modal,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf
} from "obsidian";
import path from "path";

import {
  AgentEvent,
  AgentEventKind,
  AgentSessionStatus,
  AgentToolEvent,
  createAgentEvent
} from "./agent/AgentSession";
import {
  createLineDiff,
  parseProposedEditsFromMarkdown,
  ProposedEditDiffLine
} from "./agent/ProposedEdit";
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
import {
  PiReadOnlyPromptRun,
  PiSessionState,
  PiToolEvent,
  setPiRpcModel
} from "./bridge/pi/PiReadOnlyPrompt";
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
import {
  formatInternalLinkSuggestions,
  proposeInternalLinksForFile
} from "./tools/InternalLinks";
import {
  parseAllowedCommands,
  runAllowedCommand
} from "./tools/SafeCommands";
import {
  buildVaultIndexSummary,
  findRelatedVaultNotes,
  formatVaultSearchHits,
  searchVault
} from "./tools/VaultSearch";
import {
  fetchUrlText,
  parseAllowedHosts
} from "./tools/WebFetch";
import { extractPdfText } from "./tools/PdfText";

const MAX_CONTEXT_CHARS = 20000;
const MAX_DIRECTORY_CONTEXT_ITEMS = 80;
const MAX_MENTIONED_FILES = 5;
const MAX_PDF_CONTEXT_BYTES = 50 * 1024 * 1024;
const DEFAULT_CHAT_EXPORT_FOLDER = "Chats";
const TEXT_CONTEXT_EXTENSIONS = new Set([
  "bib",
  "csv",
  "json",
  "latex",
  "md",
  "mmd",
  "tex",
  "txt",
  "yaml",
  "yml"
]);

export type AgentPromptContextMode = "none" | "note" | "selection" | "vault";
export type AgentDashboardAgentView = "chat" | "history";

interface PromptContextBlock {
  eventText: string;
  promptPrefix: string;
}

interface MentionedVaultFileReference {
  end: number;
  file: TFile;
  mention: string;
  start: number;
}

interface PromptToolDirective {
  kind: "cmd" | "index" | "links" | "search" | "semantic" | "url";
  value: string;
}

export interface AgentSessionHistoryItem {
  createdAt: string;
  lastMessage: string;
  messageCount?: number;
  name: string;
  piSessionId?: string;
  title: string;
  updatedAt: string;
}

export type ProposedEditStatus =
  | "applied"
  | "apply-error"
  | "approved"
  | "denied"
  | "pending-approval";

export interface ProposedEditRecord {
  approvalId?: string;
  applyError?: string;
  createdAt: string;
  diffLines: ProposedEditDiffLine[];
  eventId: string;
  fileExists: boolean;
  id: string;
  originalText: string;
  path: string;
  replacementText: string;
  status: ProposedEditStatus;
}

interface PersistedAgentDashboardData {
  agentSession?: PersistedAgentSessionState;
  agentSessions?: PersistedAgentSessionsState;
  schemaVersion?: number;
  settings?: Partial<AgentDashboardSettings>;
}

interface PersistedAgentSessionsState {
  currentSessionName?: string;
  records?: PersistedAgentSessionRecord[];
  viewMode?: AgentDashboardAgentView;
}

interface PersistedAgentSessionRecord extends PersistedAgentSessionState {
  createdAt: string;
  lastMessage?: string;
  messageCount?: number;
  name: string;
  title: string;
}

interface PersistedAgentSessionState {
  agentEventCounter?: number;
  approvalCounter?: number;
  approvalRecords?: ApprovalRecord[];
  events?: AgentEvent[];
  piSessionId?: string;
  piSessionMessageCount?: number;
  piSessionPath?: string;
  proposedEditCounter?: number;
  proposedEdits?: ProposedEditRecord[];
  updatedAt?: string;
}

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
  proposedEdits: ProposedEditRecord[] = [];
  agentSessionHistory: AgentSessionHistoryItem[] = [];
  agentViewMode: AgentDashboardAgentView = "history";
  piSessionId?: string;
  piSessionMessageCount?: number;
  piSessionPath?: string;
  private agentEventCounter = 0;
  private approvalCounter = 0;
  private proposedEditCounter = 0;
  private activePromptRun?: PiReadOnlyPromptRun;
  private agentSessionRecords: PersistedAgentSessionRecord[] = [];
  private lastMarkdownFileInfo: MarkdownFileInfo | null = null;
  private savePluginDataTimeout?: number;

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
        new Notice(`Local Sidekick bridge failed: ${snapshot.error}`);
      }
    }

    this.addAgentEvent(
      "status",
      `Persistent agent session ready: ${this.settings.agentSessionName}. Shell commands and deletes are blocked; approved vault Markdown edits can be applied.`
    );
    this.agentViewMode = "history";

    this.registerView(
      AGENT_DASHBOARD_VIEW_TYPE,
      (leaf) => new AgentDashboardView(leaf, this)
    );

    registerAgentDashboardBlock(this);
    this.addSettingTab(new AgentDashboardSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.rememberActiveMarkdownFileInfo();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor, info) => {
        if (info.file) {
          this.lastMarkdownFileInfo = info;
        }
      })
    );

    this.addRibbonIcon("bot", "Open Local Sidekick", async () => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-sidekick",
      name: "Open sidekick",
      callback: async () => {
        await this.activateView();
      }
    });

    this.addCommand({
      id: "insert-sidekick-block",
      name: "Insert sidekick block",
      editorCallback: (editor) => {
        editor.replaceSelection(
          [
            "```sidekick",
            "workspace: vault",
            "mode: compact",
            "session: default",
            "```"
          ].join("\n")
        );
      }
    });

    this.addCommand({
      id: "restart-sidekick-bridge",
      name: "Restart sidekick bridge",
      callback: async () => {
        const snapshot = await this.bridge.restart();
        this.showBridgeNotice(snapshot.status);
        this.refreshDashboardViews();
      }
    });

    this.addCommand({
      id: "stop-sidekick-bridge",
      name: "Stop sidekick bridge",
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
      id: "start-new-agent-session",
      name: "Start new persistent agent session",
      callback: () => {
        void this.startNewAgentSession();
      }
    });

    this.addCommand({
      id: "export-agent-chat",
      name: "Export active agent chat to Markdown",
      callback: () => {
        this.openChatExportModal();
      }
    });

    this.addCommand({
      id: "suggest-internal-links",
      name: "Suggest internal links for current note",
      callback: () => {
        void this.suggestInternalLinksForActiveNote();
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

    new Notice("Local Sidekick loaded");
  }

  async onunload(): Promise<void> {
    if (this.activePromptRun) {
      this.activePromptRun.abort();
      this.activePromptRun = undefined;
    }

    await this.flushPluginDataSave();
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
        new Notice("Unable to open Local Sidekick");
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
    const data = await this.loadData();
    const settings = getPersistedSettings(data);
    this.settings = normalizeSettings(
      Object.assign({}, DEFAULT_SETTINGS, settings)
    );
    this.restorePersistedAgentSessions(data);
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
  }

  resetPiSessionMetadata(): void {
    this.piSessionId = undefined;
    this.piSessionMessageCount = undefined;
    this.piSessionPath = undefined;
    this.queuePluginDataSave();
  }

  async startNewAgentSession(): Promise<void> {
    if (this.agentSessionStatus === "running") {
      new Notice("Stop the current agent run before starting a new session");
      return;
    }

    this.saveCurrentSessionToHistory();
    this.settings.agentSessionName = createAgentSessionName();
    this.resetPiSessionMetadata();
    this.agentEvents = [];
    this.approvalRecords = [];
    this.proposedEdits = [];
    this.agentEventCounter = 0;
    this.approvalCounter = 0;
    this.proposedEditCounter = 0;
    this.agentViewMode = "chat";
    this.addAgentEvent(
      "status",
      `Started new persistent agent session: ${this.settings.agentSessionName}.`
    );
    await this.savePluginData();
    this.refreshDashboardViews();
  }

  async openAgentSession(name: string): Promise<void> {
    if (this.agentSessionStatus === "running") {
      new Notice("Stop the current agent run before switching sessions");
      return;
    }

    this.saveCurrentSessionToHistory();
    const session = this.getPersistedSessionRecord(name);
    if (!session) {
      new Notice(`Session not found: ${name}`);
      return;
    }

    this.restorePersistedAgentSession(session);
    this.settings.agentSessionName = session.name;
    this.agentViewMode = "chat";
    await this.savePluginData();
    this.refreshDashboardViews();
  }

  async showAgentHistory(): Promise<void> {
    if (this.agentSessionStatus === "running") {
      new Notice("Stop the current agent run before leaving chat");
      return;
    }

    this.saveCurrentSessionToHistory();
    this.agentViewMode = "history";
    await this.savePluginData();
    this.refreshDashboardViews();
  }

  async showActiveAgentSession(): Promise<void> {
    this.agentViewMode = "chat";
    await this.savePluginData();
    this.refreshDashboardViews();
  }

  getAgentSessionHistory(): AgentSessionHistoryItem[] {
    this.saveCurrentSessionToHistory();
    return [...this.agentSessionHistory].sort(
      (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    );
  }

  getAgentSessionSummary(): string {
    const parts = [this.settings.agentSessionName || DEFAULT_SETTINGS.agentSessionName];

    if (this.piSessionMessageCount !== undefined) {
      parts.push(`${this.piSessionMessageCount} messages`);
    }

    if (this.piSessionId) {
      parts.push(this.piSessionId.slice(0, 8));
    }

    return parts.join(" · ");
  }

  getSuggestedChatExportPath(): string {
    const record = this.createCurrentSessionRecord();
    const title = record.title || this.settings.agentSessionName || "chat";
    const fileName = `${slugifyFileName(title)}.md`;
    return `${DEFAULT_CHAT_EXPORT_FOLDER}/${fileName}`;
  }

  openChatExportModal(): void {
    if (countConversationMessages(this.agentEvents) === 0) {
      new Notice("No chat messages to export yet");
      return;
    }

    new AgentChatExportModal(this.app, this).open();
  }

  async exportActiveAgentChat(exportPath: string): Promise<void> {
    if (this.agentSessionStatus === "running") {
      new Notice("Stop the current agent run before exporting");
      return;
    }

    const record = this.createCurrentSessionRecord();
    if (countConversationMessages(record.events ?? []) === 0) {
      new Notice("No chat messages to export yet");
      return;
    }

    let normalizedPath: string;
    try {
      normalizedPath = normalizeChatExportPath(exportPath);
    } catch (error) {
      new Notice(getErrorMessage(error));
      return;
    }

    const folderPath = path.posix.dirname(normalizedPath);
    if (folderPath && folderPath !== ".") {
      await this.ensureVaultFolder(folderPath);
    }

    const outputPath = await this.getAvailableVaultPath(normalizedPath);
    const markdown = buildChatExportMarkdown(record, {
      exportedAt: new Date().toISOString(),
      model: this.settings.selectedPiModel,
      pluginVersion: this.manifest.version
    });

    await this.app.vault.create(outputPath, markdown);
    new Notice(`Exported chat to ${outputPath}`);

    const exportedFile = this.app.vault.getFileByPath(outputPath);
    if (exportedFile) {
      await this.app.workspace.getLeaf(false).openFile(exportedFile);
    }
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
      this.selectDefaultPiModelIfNeeded();
      new Notice("Pi RPC discovery ready");
      return;
    }

    new Notice(`Pi RPC discovery failed: ${this.piRpcDiscoverySnapshot.error}`);
  }

  async sendAgentPrompt(
    prompt: string,
    contextMode: AgentPromptContextMode = "none"
  ): Promise<boolean> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      new Notice("Enter a prompt first");
      return false;
    }

    if (this.agentSessionStatus === "running") {
      new Notice("Agent is already running");
      return false;
    }

    const contextBlocks: PromptContextBlock[] = [];
    if (contextMode !== "none" && contextMode !== "vault") {
      const context = await this.buildPromptContext(contextMode);
      if (!context) {
        return false;
      }

      contextBlocks.push(context);
    }

    if (contextMode === "vault") {
      const vaultContext = await this.buildVaultSearchPromptContext(trimmedPrompt);
      contextBlocks.push(...vaultContext);
    }

    const mentionContext = await this.buildMentionedFileContext(trimmedPrompt);
    if (!mentionContext) {
      return false;
    }

    contextBlocks.push(...mentionContext);
    const directiveContext = await this.buildDirectivePromptContext(trimmedPrompt);
    if (!directiveContext) {
      return false;
    }

    contextBlocks.push(...directiveContext);
    for (const context of contextBlocks) {
      this.addAgentEvent("tool", context.eventText);
    }

    const promptForPi = [
      ...contextBlocks.map((context) => context.promptPrefix),
      getVaultGroundingInstructions(),
      getEditProposalInstructions(),
      trimmedPrompt
    ].join("\n\n");

    this.addAgentEvent("user", trimmedPrompt);
    this.agentViewMode = "chat";
    this.agentSessionStatus = "running";
    const sessionPath = this.getPiSessionPath();
    const toolMode = this.settings.piToolMode;
    const workspaceRoot = this.getVaultRoot();
    if (toolMode === "read-only" && !workspaceRoot) {
      this.agentSessionStatus = "idle";
      new Notice("Read-only Pi tools require a local filesystem vault.");
      this.refreshDashboardViews();
      return false;
    }

    const promptDecision = this.assessSafetyRequest({
      kind: "prompt",
      command: `${this.settings.piExecutablePath} --mode rpc ${sessionPath ? `--session ${sessionPath}` : "--no-session"} ${formatPiToolFlag(toolMode)}`,
      description: `Run Pi prompt with ${describePiToolMode(toolMode)}`
    });

    if (!promptDecision.allowed) {
      this.agentSessionStatus = "idle";
      this.addAgentEvent(
        "tool",
        `Safety guard blocked prompt: ${promptDecision.reason}`
      );
      this.refreshDashboardViews();
      return false;
    }

    this.addAgentEvent(
      "tool",
      `Safety guard allowed prompt: ${promptDecision.reason}`
    );
    this.addAgentEvent("status", `Starting Pi prompt (${describePiToolMode(toolMode)}).`);
    this.refreshDashboardViews();
    this.startReadOnlyPiPrompt(promptForPi, sessionPath, toolMode, workspaceRoot);

    return true;
  }

  stopAgentRun(): void {
    if (this.activePromptRun) {
      this.activePromptRun.abort();
      this.activePromptRun = undefined;
    }

    if (this.agentSessionStatus === "running") {
      this.agentSessionStatus = "idle";
      this.addAgentEvent("status", "Pi read-only prompt stopped.");
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
    const proposedEdit = this.proposedEdits.find(
      (edit) => edit.approvalId === record.id
    );
    if (proposedEdit) {
      proposedEdit.status = "approved";
      record.note = "Approval recorded. Apply from the proposed edit card.";
    } else {
      record.note =
        "Approval recorded only. No execution path is available for this request.";
    }
    this.addAgentEvent(
      "tool",
      `Approval recorded for ${describeSafetyRequest(record.decision.request)}.`
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
    const proposedEdit = this.proposedEdits.find(
      (edit) => edit.approvalId === record.id
    );
    if (proposedEdit) {
      proposedEdit.status = "denied";
    }
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
      mode: "reviewed-edits",
      pendingApprovals: countPendingApprovals(this.approvalRecords),
      vaultRoot
    };
  }

  getPendingApprovalRecords(): ApprovalRecord[] {
    return this.approvalRecords.filter((record) => record.status === "pending");
  }

  getProposedEditsForEvent(eventId: string): ProposedEditRecord[] {
    return this.proposedEdits.filter((record) => record.eventId === eventId);
  }

  async openVaultFilePath(vaultPath: string): Promise<void> {
    const file = this.app.vault.getFileByPath(vaultPath);
    if (!file) {
      new Notice(`File not found: ${vaultPath}`);
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async applyProposedEdit(id: string): Promise<void> {
    const proposedEdit = this.proposedEdits.find((record) => record.id === id);
    if (!proposedEdit) {
      new Notice("Proposed edit not found");
      return;
    }

    const approval = proposedEdit.approvalId
      ? this.approvalRecords.find((record) => record.id === proposedEdit.approvalId)
      : undefined;
    if (!approval || approval.status !== "approved") {
      new Notice("Approve the proposed edit before applying it");
      return;
    }

    if (!proposedEdit.path.toLowerCase().endsWith(".md")) {
      proposedEdit.status = "apply-error";
      proposedEdit.applyError = "Only Markdown files can be applied.";
      this.addAgentEvent(
        "tool",
        `Apply blocked for ${proposedEdit.path}: only Markdown files can be applied.`
      );
      this.refreshDashboardViews();
      return;
    }

    const targetPath = this.getVaultPathAbsolutePath(proposedEdit.path);
    const applyDecision = this.assessSafetyRequest({
      description: `Apply approved proposed edit to ${proposedEdit.path}`,
      kind: "approved-write",
      targetPath
    });

    if (!applyDecision.allowed) {
      proposedEdit.status = "apply-error";
      proposedEdit.applyError = applyDecision.reason;
      this.addAgentEvent(
        "tool",
        `Apply blocked for ${proposedEdit.path}: ${applyDecision.reason}`
      );
      this.refreshDashboardViews();
      return;
    }

    const existingFile = this.app.vault.getFileByPath(proposedEdit.path);
    if (proposedEdit.fileExists) {
      if (!existingFile) {
        this.markProposedEditStale(
          proposedEdit,
          "Target file no longer exists."
        );
        return;
      }

      const currentText = await this.app.vault.read(existingFile);
      if (currentText !== proposedEdit.originalText) {
        this.markProposedEditStale(
          proposedEdit,
          "Target file changed after the diff was generated."
        );
        return;
      }

      await this.app.vault.modify(existingFile, proposedEdit.replacementText);
      this.markProposedEditApplied(proposedEdit);
      return;
    }

    if (existingFile) {
      this.markProposedEditStale(
        proposedEdit,
        "Target file was created after the diff was generated."
      );
      return;
    }

    try {
      await this.app.vault.create(proposedEdit.path, proposedEdit.replacementText);
      proposedEdit.fileExists = true;
      this.markProposedEditApplied(proposedEdit);
    } catch (error) {
      proposedEdit.status = "apply-error";
      proposedEdit.applyError = getErrorMessage(error);
      this.addAgentEvent(
        "tool",
        `Apply failed for ${proposedEdit.path}: ${proposedEdit.applyError}`
      );
      this.refreshDashboardViews();
    }
  }

  async selectPiModel(modelLabel: string): Promise<void> {
    this.settings.selectedPiModel = modelLabel;
    await this.saveSettings();
    if (!modelLabel) {
      this.addAgentEvent("status", "Cleared selected Pi model.");
      this.refreshDashboardViews();
      return;
    }

    if (this.agentSessionStatus === "running") {
      this.addAgentEvent(
        "status",
        `Selected Pi model for the next run: ${modelLabel}.`
      );
      this.refreshDashboardViews();
      return;
    }

    const result = await setPiRpcModel(
      this.settings.piExecutablePath,
      this.getPiSessionPath(),
      modelLabel
    );

    if (result.success) {
      if (result.sessionState) {
        this.rememberPiSessionState(result.sessionState);
      }
      this.addAgentEvent("status", `Set active Pi session model: ${modelLabel}.`);
    } else {
      this.addAgentEvent(
        "status",
        `Selected Pi model for future runs, but set_model failed: ${result.error ?? "unknown error"}`
      );
    }
    this.refreshDashboardViews();
  }

  getVaultFileSuggestions(query: string, limit = 8): string[] {
    const normalizedQuery = normalizeMentionedPath(query)
      .replace(/^\[\[/, "")
      .toLowerCase();
    const scoredFiles = this.app.vault.getFiles()
      .map((file) => ({
        path: file.path,
        score: scoreVaultFileSuggestion(file.path, normalizedQuery)
      }))
      .filter((item) => item.score < Number.POSITIVE_INFINITY)
      .sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));

    return scoredFiles.slice(0, limit).map((item) => item.path);
  }

  async suggestInternalLinksForActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile() ?? this.getActiveMarkdownFileInfo()?.file;
    if (!file) {
      new Notice("No active note found");
      return;
    }

    const proposal = await proposeInternalLinksForFile(this.app, file);
    const summary = formatInternalLinkSuggestions(file.path, proposal.suggestions);
    const event = this.addAgentEvent("assistant", summary);

    if (proposal.suggestions.length === 0) {
      this.refreshDashboardViews();
      return;
    }

    this.recordProposedReplacement(
      event.id,
      file.path,
      proposal.originalText,
      proposal.replacementText,
      `Apply conservative internal link suggestions to ${file.path}`
    );
    this.refreshDashboardViews();
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
    new Notice(`Local Sidekick bridge running on ${snapshot.url}`);
      return;
    }

    new Notice(`Local Sidekick bridge ${status}`);
  }

  private restorePersistedAgentSession(
    state: PersistedAgentSessionState | undefined
  ): void {
    if (!state) {
      return;
    }

    this.agentEvents = Array.isArray(state.events) ? state.events.slice(-60) : [];
    this.approvalRecords = Array.isArray(state.approvalRecords)
      ? state.approvalRecords.slice(0, 40)
      : [];
    this.proposedEdits = Array.isArray(state.proposedEdits)
      ? state.proposedEdits.slice(0, 40)
      : [];
    this.piSessionId = state.piSessionId;
    this.piSessionMessageCount = state.piSessionMessageCount;
    this.piSessionPath = state.piSessionPath;
    this.agentEventCounter =
      state.agentEventCounter ?? getMaxIdCounter(this.agentEvents, "agent-event-");
    this.approvalCounter =
      state.approvalCounter ?? getMaxIdCounter(this.approvalRecords, "approval-");
    this.proposedEditCounter =
      state.proposedEditCounter ??
      getMaxIdCounter(this.proposedEdits, "proposed-edit-");
  }

  private restorePersistedAgentSessions(data: unknown): void {
    const sessions = getPersistedAgentSessions(data);
    if (!sessions) {
      this.restorePersistedAgentSession(getPersistedAgentSession(data));
      this.saveCurrentSessionToHistory();
      return;
    }

    const records = Array.isArray(sessions.records)
      ? sessions.records.filter(isPersistedAgentSessionRecord)
      : [];
    this.agentSessionRecords = records;
    this.agentSessionHistory = records.map((record) =>
      getHistoryItemForSessionRecord(record)
    );
    this.agentViewMode = sessions.viewMode ?? "history";

    const currentName =
      sessions.currentSessionName ||
      this.settings.agentSessionName ||
      DEFAULT_SETTINGS.agentSessionName;
    const currentRecord =
      records.find((record) => record.name === currentName) ?? records[0];

    if (currentRecord) {
      this.settings.agentSessionName = currentRecord.name;
      this.restorePersistedAgentSession(currentRecord);
    }
  }

  private saveCurrentSessionToHistory(): void {
    const record = this.createCurrentSessionRecord();
    this.agentSessionRecords = [
      record,
      ...this.agentSessionRecords.filter((item) => item.name !== record.name)
    ].slice(0, 24);
    this.agentSessionHistory = [
      getHistoryItemForSessionRecord(record),
      ...this.agentSessionHistory.filter((item) => item.name !== record.name)
    ].slice(0, 24);
  }

  private getPersistedSessionRecord(
    name: string
  ): PersistedAgentSessionRecord | undefined {
    this.saveCurrentSessionToHistory();
    return this.agentSessionRecords.find(
      (record) => record.name === name
    );
  }

  private createAllPersistedSessionRecords(): PersistedAgentSessionRecord[] {
    const currentRecord = this.createCurrentSessionRecord();
    const historyRecords = this.agentSessionRecords.filter(
      (item) => item.name !== currentRecord.name
    );

    return [currentRecord, ...historyRecords].slice(0, 24);
  }

  private createCurrentSessionRecord(): PersistedAgentSessionRecord {
    const existing = this.agentSessionHistory.find(
      (item) => item.name === this.settings.agentSessionName
    );
    const updatedAt = new Date().toISOString();

    return {
      agentEventCounter: this.agentEventCounter,
      approvalCounter: this.approvalCounter,
      approvalRecords: this.approvalRecords,
      createdAt:
        existing?.createdAt ?? this.agentEvents[0]?.createdAt ?? updatedAt,
      events: this.agentEvents,
      lastMessage: getSessionLastMessage(this.agentEvents),
      messageCount: countConversationMessages(this.agentEvents),
      name: this.settings.agentSessionName || DEFAULT_SETTINGS.agentSessionName,
      piSessionId: this.piSessionId,
      piSessionMessageCount: this.piSessionMessageCount,
      piSessionPath: this.piSessionPath,
      proposedEditCounter: this.proposedEditCounter,
      proposedEdits: this.proposedEdits,
      title: getSessionTitle(
        this.agentEvents,
        existing?.title ?? this.settings.agentSessionName
      ),
      updatedAt
    };
  }

  private queuePluginDataSave(): void {
    if (this.savePluginDataTimeout !== undefined) {
      window.clearTimeout(this.savePluginDataTimeout);
    }

    this.savePluginDataTimeout = window.setTimeout(() => {
      this.savePluginDataTimeout = undefined;
      void this.savePluginData();
    }, 300);
  }

  private async flushPluginDataSave(): Promise<void> {
    if (this.savePluginDataTimeout !== undefined) {
      window.clearTimeout(this.savePluginDataTimeout);
      this.savePluginDataTimeout = undefined;
    }

    await this.savePluginData();
  }

  private async savePluginData(): Promise<void> {
    this.saveCurrentSessionToHistory();
    const sessionRecords = this.createAllPersistedSessionRecords();
    const data: PersistedAgentDashboardData = {
      agentSession: {
        agentEventCounter: this.agentEventCounter,
        approvalCounter: this.approvalCounter,
        approvalRecords: this.approvalRecords,
        events: this.agentEvents,
        piSessionId: this.piSessionId,
        piSessionMessageCount: this.piSessionMessageCount,
        piSessionPath: this.piSessionPath,
        proposedEditCounter: this.proposedEditCounter,
        proposedEdits: this.proposedEdits,
        updatedAt: new Date().toISOString()
      },
      agentSessions: {
        currentSessionName: this.settings.agentSessionName,
        records: sessionRecords,
        viewMode: this.agentViewMode
      },
      schemaVersion: 3,
      settings: this.settings
    };

    await this.saveData(data);
  }

  private getVaultRoot(): string | undefined {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }

    return undefined;
  }

  private getPiSessionPath(): string | undefined {
    const vaultRoot = this.getVaultRoot();
    if (!vaultRoot) {
      return undefined;
    }

    const pluginDir = this.manifest.dir
      ? path.join(vaultRoot, this.manifest.dir)
      : path.join(
          vaultRoot,
          this.app.vault.configDir,
          "plugins",
          this.manifest.id
        );
    const sessionName = sanitizeSessionFileName(
      this.settings.agentSessionName || DEFAULT_SETTINGS.agentSessionName
    );

    return path.join(pluginDir, "pi-sessions", `${sessionName}.jsonl`);
  }

  private async ensureVaultFolder(folderPath: string): Promise<void> {
    const normalized = normalizeVaultFolderPath(folderPath);
    if (!normalized) {
      return;
    }

    const segments = normalized.split("/");
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (await this.app.vault.adapter.exists(currentPath)) {
        continue;
      }

      await this.app.vault.createFolder(currentPath);
    }
  }

  private async getAvailableVaultPath(vaultPath: string): Promise<string> {
    if (!(await this.app.vault.adapter.exists(vaultPath))) {
      return vaultPath;
    }

    const extension = path.posix.extname(vaultPath) || ".md";
    const basePath = vaultPath.slice(0, -extension.length);
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${basePath}-${index}${extension}`;
      if (!(await this.app.vault.adapter.exists(candidate))) {
        return candidate;
      }
    }

    return `${basePath}-${Date.now()}${extension}`;
  }

  private rememberPiSessionState(state: PiSessionState): void {
    if (state.sessionFile) {
      this.piSessionPath = state.sessionFile;
    }

    if (state.sessionId) {
      this.piSessionId = state.sessionId;
    }

    if (state.messageCount !== undefined) {
      this.piSessionMessageCount = state.messageCount;
    }

    this.queuePluginDataSave();
  }

  private addAgentEvent(
    kind: AgentEventKind,
    text: string,
    tool?: AgentToolEvent
  ): AgentEvent {
    this.agentEventCounter += 1;
    const event = createAgentEvent(
      `agent-event-${this.agentEventCounter}`,
      kind,
      text,
      tool
    );
    this.agentEvents.push(event);

    if (this.agentEvents.length > 60) {
      this.agentEvents = this.agentEvents.slice(-60);
    }

    this.queuePluginDataSave();
    return event;
  }

  private addToolEvent(event: AgentToolEvent): AgentEvent {
    return this.addAgentEvent("tool", event.title, event);
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

    this.queuePluginDataSave();
    return record;
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

  private markProposedEditApplied(proposedEdit: ProposedEditRecord): void {
    proposedEdit.status = "applied";
    proposedEdit.applyError = undefined;
    proposedEdit.originalText = proposedEdit.replacementText;
    proposedEdit.diffLines = createLineDiff(
      proposedEdit.replacementText,
      proposedEdit.replacementText
    );
    this.addAgentEvent(
      "tool",
      `Applied proposed edit to ${proposedEdit.path}.`
    );
    this.refreshDashboardViews();
  }

  private markProposedEditStale(
    proposedEdit: ProposedEditRecord,
    reason: string
  ): void {
    proposedEdit.status = "apply-error";
    proposedEdit.applyError = reason;
    this.addAgentEvent(
      "tool",
      `Apply blocked for ${proposedEdit.path}: ${reason}`
    );
    this.refreshDashboardViews();
  }

  private recordProposedReplacement(
    eventId: string,
    vaultPath: string,
    originalText: string,
    replacementText: string,
    description: string
  ): void {
    if (originalText === replacementText) {
      return;
    }

    const targetPath = this.getVaultPathAbsolutePath(vaultPath);
    const decision = this.assessSafetyRequest({
      description,
      kind: "write",
      targetPath
    });
    const approval = this.enqueueApproval(decision);
    const file = this.app.vault.getFileByPath(vaultPath);

    this.proposedEditCounter += 1;
    this.proposedEdits.unshift({
      approvalId: approval.id,
      createdAt: new Date().toISOString(),
      diffLines: createLineDiff(originalText, replacementText),
      eventId,
      fileExists: file !== null,
      id: `proposed-edit-${this.proposedEditCounter}`,
      originalText,
      path: vaultPath,
      replacementText,
      status: "pending-approval"
    });

    if (this.proposedEdits.length > 40) {
      this.proposedEdits = this.proposedEdits.slice(0, 40);
    }
  }

  private async recordProposedEdits(
    eventId: string | undefined,
    text: string
  ): Promise<void> {
    if (!eventId) {
      return;
    }

    const parsedEdits = parseProposedEditsFromMarkdown(text);
    if (parsedEdits.length === 0) {
      return;
    }

    let recordedCount = 0;
    for (const parsedEdit of parsedEdits) {
      const vaultPath = normalizeProposedEditPath(parsedEdit.path);
      if (!vaultPath) {
        this.addAgentEvent(
          "tool",
          `Ignored proposed edit with invalid path: ${parsedEdit.path}`
        );
        continue;
      }

      const duplicate = this.proposedEdits.some(
        (record) =>
          record.eventId === eventId &&
          record.path === vaultPath &&
          record.replacementText === parsedEdit.replacementText
      );
      if (duplicate) {
        continue;
      }

      const file = this.app.vault.getFileByPath(vaultPath);
      const originalText = file ? await this.app.vault.read(file) : "";
      const targetPath = this.getVaultPathAbsolutePath(vaultPath);
      const decision = this.assessSafetyRequest({
        description: `Apply proposed edit to ${vaultPath}`,
        kind: "write",
        targetPath
      });
      const approval = this.enqueueApproval(decision);

      this.proposedEditCounter += 1;
      this.proposedEdits.unshift({
        approvalId: approval.id,
        createdAt: new Date().toISOString(),
        diffLines: createLineDiff(originalText, parsedEdit.replacementText),
        eventId,
        fileExists: file !== null,
        id: `proposed-edit-${this.proposedEditCounter}`,
        originalText,
        path: vaultPath,
        replacementText: parsedEdit.replacementText,
        status: "pending-approval"
      });
      recordedCount += 1;
    }

    if (this.proposedEdits.length > 40) {
      this.proposedEdits = this.proposedEdits.slice(0, 40);
    }

    if (recordedCount > 0) {
      this.addAgentEvent(
        "tool",
        `Detected ${recordedCount} proposed edit(s). Approve before applying.`
      );
      this.refreshDashboardViews();
    }
  }

  private async buildPromptContext(
    mode: Exclude<AgentPromptContextMode, "none">
  ): Promise<PromptContextBlock | undefined> {
    const activeInfo = this.getActiveMarkdownFileInfo();
    const file =
      mode === "selection"
        ? activeInfo?.file
        : this.app.workspace.getActiveFile() ?? activeInfo?.file;

    if (!file) {
      new Notice("No active note found");
      return undefined;
    }

    const targetPath = this.getVaultFileAbsolutePath(file);
    const readDecision = this.assessSafetyRequest({
      description:
        mode === "note" ? "Read current note context" : "Read selection context",
      kind: "read",
      targetPath
    });

    if (!readDecision.allowed) {
      this.addAgentEvent(
        "tool",
        `Safety guard blocked context: ${readDecision.reason}`
      );
      this.refreshDashboardViews();
      return undefined;
    }

    if (mode === "selection") {
      const selection = activeInfo?.editor?.getSelection().trim() ?? "";
      if (!selection) {
        new Notice("No active editor selection found");
        return undefined;
      }

      const text = limitContextText(selection);
      return {
        eventText: `Added selection context from ${file.path} (${text.length.toLocaleString()} chars).`,
        promptPrefix: formatPromptContext("Current selection", file.path, text)
      };
    }

    const contents = await this.app.vault.read(file);
    const text = limitContextText(contents);
    return {
      eventText: `Added current note context from ${file.path} (${text.length.toLocaleString()} chars).`,
      promptPrefix: formatPromptContext("Current note", file.path, text)
    };
  }

  private async buildMentionedFileContext(
    prompt: string
  ): Promise<PromptContextBlock[] | undefined> {
    const mentionedFiles = extractMentionedVaultFileReferences(
      prompt,
      this.app.vault.getFiles()
    );
    const unresolvedMentions = extractUnresolvedMentionedVaultPaths(
      prompt,
      mentionedFiles
    );

    if (unresolvedMentions.length > 0) {
      const unresolvedMention = unresolvedMentions[0];
      new Notice(`Could not resolve @${unresolvedMention}`);
      this.addAgentEvent(
        "tool",
        `Blocked @ context: @${unresolvedMention} was not found in the vault.`
      );
      this.refreshDashboardViews();
      return undefined;
    }

    if (mentionedFiles.length === 0) {
      return [];
    }

    if (mentionedFiles.length > MAX_MENTIONED_FILES) {
      new Notice(
        `Too many @ files. Limit is ${MAX_MENTIONED_FILES} per prompt.`
      );
      return undefined;
    }

    const blocks: PromptContextBlock[] = [];
    for (const mentionedFile of mentionedFiles) {
      const file = mentionedFile.file;
      const targetPath = this.getVaultFileAbsolutePath(file);
      const readDecision = this.assessSafetyRequest({
        description: `Read @ file context: ${file.path}`,
        kind: "read",
        targetPath
      });

      if (!readDecision.allowed) {
        this.addAgentEvent(
          "tool",
          `Safety guard blocked @${mentionedFile.mention}: ${readDecision.reason}`
        );
        this.refreshDashboardViews();
        return undefined;
      }

      if (file.extension.toLowerCase() === "pdf") {
        blocks.push(await this.buildMentionedPdfContext(file));
      } else if (canReadMentionedFileAsText(file)) {
        const contents = await this.app.vault.read(file);
        const text = limitContextText(contents);
        blocks.push({
          eventText: `Added @ context from ${file.path} (${text.length.toLocaleString()} chars).`,
          promptPrefix: formatPromptContext("Mentioned file", file.path, text)
        });
      } else {
        const attachmentContext = formatMentionedAttachmentContext(file);
        blocks.push({
          eventText: `Added @ attachment reference for ${file.path}.`,
          promptPrefix: formatPromptContext(
            "Mentioned attachment",
            file.path,
            attachmentContext
          )
        });
      }

      const directoryContext = this.buildMentionedFileDirectoryContext(file);
      if (directoryContext) {
        blocks.push(directoryContext);
      }
    }

    return blocks;
  }

  private buildMentionedFileDirectoryContext(
    file: TFile
  ): PromptContextBlock | undefined {
    const folderPath = getVaultFolderPath(file.path);
    const targetPath = this.getVaultPathAbsolutePath(folderPath);
    const readDecision = this.assessSafetyRequest({
      description: `List vault directory for @ file: ${formatVaultFolderLabel(folderPath)}`,
      kind: "read",
      targetPath
    });

    if (!readDecision.allowed) {
      this.addAgentEvent(
        "tool",
        `Safety guard blocked directory context for ${file.path}: ${readDecision.reason}`
      );
      this.refreshDashboardViews();
      return undefined;
    }

    const directoryContext = formatVaultDirectoryContext(
      file,
      this.app.vault.getAllLoadedFiles()
    );

    return {
      eventText: `Added directory context for ${formatVaultFolderLabel(folderPath)}.`,
      promptPrefix: formatPromptContext(
        "Vault directory listing",
        formatVaultFolderLabel(folderPath),
        directoryContext
      )
    };
  }

  private async buildMentionedPdfContext(file: TFile): Promise<PromptContextBlock> {
    if (file.stat.size > MAX_PDF_CONTEXT_BYTES) {
      return {
        eventText: `Added @ PDF reference for ${file.path}; extraction skipped because the file is too large.`,
        promptPrefix: formatPromptContext(
          "Mentioned PDF attachment",
          file.path,
          formatMentionedAttachmentContext(
            file,
            `PDF text extraction skipped because the file is larger than ${(MAX_PDF_CONTEXT_BYTES / 1024 / 1024).toLocaleString()} MB.`
          )
        )
      };
    }

    try {
      const data = await this.app.vault.readBinary(file);
      const extracted = extractPdfText(data, MAX_CONTEXT_CHARS);
      if (!extracted.text) {
        return {
          eventText: `Added @ PDF reference for ${file.path}; no selectable text was extracted.`,
          promptPrefix: formatPromptContext(
            "Mentioned PDF attachment",
            file.path,
            formatMentionedAttachmentContext(file, extracted.warning)
          )
        };
      }

      return {
        eventText: `Extracted @ PDF text from ${file.path} (${extracted.text.length.toLocaleString()} chars).`,
        promptPrefix: formatPromptContext(
          "Mentioned PDF text",
          file.path,
          [
            `Path: ${file.path}`,
            `Extracted text blocks: ${extracted.pageLikeBlocks}`,
            extracted.warning ? `Warning: ${extracted.warning}` : "",
            "",
            extracted.text
          ].filter(Boolean).join("\n")
        )
      };
    } catch (error) {
      return {
        eventText: `Added @ PDF reference for ${file.path}; extraction failed.`,
        promptPrefix: formatPromptContext(
          "Mentioned PDF attachment",
          file.path,
          formatMentionedAttachmentContext(
            file,
            `PDF text extraction failed: ${getErrorMessage(error)}`
          )
        )
      };
    }
  }

  private async buildVaultSearchPromptContext(
    query: string
  ): Promise<PromptContextBlock[]> {
    const [exactHits, relatedHits, indexSummary] = await Promise.all([
      searchVault(this.app, query, 8),
      findRelatedVaultNotes(this.app, query, 8),
      buildVaultIndexSummary(this.app, 80)
    ]);

    return [
      {
        eventText: `Added vault search context for "${truncatePlainText(query, 48)}".`,
        promptPrefix: formatPromptContext(
          "Vault search",
          "vault",
          [
            formatVaultSearchHits("Exact/metadata vault search", query, exactHits),
            "",
            formatVaultSearchHits("Related-note search", query, relatedHits),
            "",
            indexSummary
          ].join("\n")
        )
      }
    ];
  }

  private async buildDirectivePromptContext(
    prompt: string
  ): Promise<PromptContextBlock[] | undefined> {
    const directives = extractPromptToolDirectives(prompt);
    if (directives.length === 0) {
      return [];
    }

    const blocks: PromptContextBlock[] = [];
    for (const directive of directives) {
      if (directive.kind === "search") {
        const hits = await searchVault(this.app, directive.value, 10);
        blocks.push({
          eventText: `Ran vault search for "${directive.value}".`,
          promptPrefix: formatPromptContext(
            "Vault search",
            `@search(${directive.value})`,
            formatVaultSearchHits("Exact/metadata vault search", directive.value, hits)
          )
        });
        continue;
      }

      if (directive.kind === "semantic") {
        const hits = await findRelatedVaultNotes(this.app, directive.value, 10);
        blocks.push({
          eventText: `Ran related-note search for "${directive.value}".`,
          promptPrefix: formatPromptContext(
            "Related-note search",
            `@semantic(${directive.value})`,
            formatVaultSearchHits("Related-note search", directive.value, hits)
          )
        });
        continue;
      }

      if (directive.kind === "index") {
        blocks.push({
          eventText: "Added vault filename/header index.",
          promptPrefix: formatPromptContext(
            "Vault filename and heading index",
            "vault",
            await buildVaultIndexSummary(this.app)
          )
        });
        continue;
      }

      if (directive.kind === "url") {
        if (!this.settings.webFetchEnabled) {
          this.addAgentEvent("tool", "Blocked URL fetch: web fetch is disabled.");
          continue;
        }

        const result = await fetchUrlText(
          directive.value,
          parseAllowedHosts(this.settings.webFetchAllowedHosts)
        );
        blocks.push({
          eventText: result.error
            ? `URL fetch failed for ${directive.value}: ${result.error}`
            : `Fetched URL context from ${result.url}.`,
          promptPrefix: formatPromptContext(
            "Fetched URL",
            result.url,
            result.error
              ? `Fetch failed: ${result.error}`
              : [`Title: ${result.title ?? "unknown"}`, "", result.content].join("\n")
          )
        });
        continue;
      }

      if (directive.kind === "cmd") {
        const allowedCommands = parseAllowedCommands(this.settings.safeCommandAllowlist);
        const commandAllowed = allowedCommands.includes(
          directive.value.trim().replace(/\s+/g, " ")
        );
        const decision = this.assessSafetyRequest({
          command: directive.value,
          description: `Run safe command: ${directive.value}`,
          kind: commandAllowed ? "safe-command" : "shell"
        });
        if (!decision.allowed) {
          blocks.push({
            eventText: `Blocked command context: ${decision.reason}`,
            promptPrefix: formatPromptContext(
              "Safe command output",
              directive.value,
              `Command blocked: ${decision.reason}`
            )
          });
          continue;
        }

        const result = await runAllowedCommand(
          directive.value,
          allowedCommands,
          this.getVaultRoot()
        );
        blocks.push({
          eventText: result.success
            ? `Ran safe command: ${result.command}`
            : `Safe command blocked or failed: ${result.command}`,
          promptPrefix: formatPromptContext(
            "Safe command output",
            result.command,
            [
              `Command: ${result.command}`,
              `Success: ${result.success}`,
              result.exitCode === undefined ? "" : `Exit code: ${result.exitCode}`,
              "",
              result.output
            ].filter(Boolean).join("\n")
          )
        });
        continue;
      }

      if (directive.kind === "links") {
        const file = directive.value
          ? this.app.vault.getFileByPath(normalizeMentionedPath(directive.value))
          : this.app.workspace.getActiveFile() ?? this.getActiveMarkdownFileInfo()?.file;
        if (!file) {
          this.addAgentEvent("tool", "Internal link suggestions skipped: note not found.");
          continue;
        }

        const proposal = await proposeInternalLinksForFile(this.app, file);
        blocks.push({
          eventText: `Added internal link suggestions for ${file.path}.`,
          promptPrefix: formatPromptContext(
            "Internal link suggestions",
            file.path,
            formatInternalLinkSuggestions(file.path, proposal.suggestions)
          )
        });
      }
    }

    return blocks;
  }

  private getActiveMarkdownFileInfo(): MarkdownFileInfo | null {
    const activeEditor = this.app.workspace.activeEditor;
    if (activeEditor?.file) {
      this.lastMarkdownFileInfo = activeEditor;
      return activeEditor;
    }

    return this.lastMarkdownFileInfo;
  }

  private rememberActiveMarkdownFileInfo(): void {
    const activeEditor = this.app.workspace.activeEditor;
    if (activeEditor?.file) {
      this.lastMarkdownFileInfo = activeEditor;
    }
  }

  private getVaultFileAbsolutePath(file: TFile): string {
    return this.getVaultPathAbsolutePath(file.path);
  }

  private getVaultPathAbsolutePath(vaultPath: string): string {
    const vaultRoot = this.getVaultRoot();
    if (!vaultRoot) {
      return vaultPath;
    }

    return path.join(vaultRoot, vaultPath);
  }

  private selectDefaultPiModelIfNeeded(): void {
    if (this.settings.selectedPiModel) {
      return;
    }

    const currentModel = this.piRpcDiscoverySnapshot.currentModel;
    const discoveredModels = this.piRpcDiscoverySnapshot.models;
    const fallbackModel = discoveredModels[0]?.label;
    const selectedModel = currentModel || fallbackModel;

    if (selectedModel) {
      this.settings.selectedPiModel = selectedModel;
      void this.saveSettings();
    }
  }

  private startReadOnlyPiPrompt(
    prompt: string,
    sessionPath: string | undefined,
    toolMode: "disabled" | "read-only",
    workspaceRoot: string | undefined
  ): void {
    let assistantText = "";
    let assistantEventId: string | undefined;
    const selectedModel = this.settings.selectedPiModel;

    this.activePromptRun = new PiReadOnlyPromptRun(
      {
        executablePath: this.settings.piExecutablePath,
        modelLabel: selectedModel,
        prompt,
        sessionPath,
        timeoutMs: this.settings.piPromptTimeoutMinutes * 60_000,
        toolMode,
        workspaceRoot
      },
      {
        onAssistantDelta: (delta) => {
          assistantText += delta;
          if (!assistantEventId) {
            assistantEventId = this.addAgentEvent("assistant", assistantText).id;
          } else {
            this.updateAgentEvent(assistantEventId, assistantText);
          }
          this.refreshDashboardViews();
        },
        onError: (message) => {
          this.activePromptRun = undefined;
          this.agentSessionStatus = "error";
          this.addAgentEvent("status", `Pi read-only prompt failed: ${message}`);
          this.refreshDashboardViews();
        },
        onSessionState: (state) => {
          this.rememberPiSessionState(state);
          this.refreshDashboardViews();
        },
        onStatus: (message) => {
          if (isPiToolSupportErrorStatus(message)) {
            new Notice("Selected model does not support Pi tools. Disable Pi tools or choose another model.");
          }

          if (message.includes("complete") || message.includes("stopped")) {
            if (message.includes("complete")) {
              void this.recordProposedEdits(assistantEventId, assistantText);
            }
            this.activePromptRun = undefined;
            this.agentSessionStatus = "idle";
          }
          this.addAgentEvent("status", message);
          this.refreshDashboardViews();
        },
        onToolEvent: (event) => {
          const decision = this.assessSafetyRequest({
            description: event.title,
            kind: "shell"
          });
          this.enqueueApproval(decision);
          this.addToolEvent(createBlockedToolEvent(event));
          this.refreshDashboardViews();
        }
      }
    );

    this.activePromptRun.start();
  }

  private updateAgentEvent(id: string, text: string): void {
    const event = this.agentEvents.find((item) => item.id === id);
    if (event) {
      event.text = text;
      this.queuePluginDataSave();
    }
  }
}

function formatPromptContext(label: string, filePath: string, text: string): string {
  return [
    `<obsidian-context label="${label}" path="${filePath}">`,
    text,
    "</obsidian-context>"
  ].join("\n");
}

function formatPiToolFlag(toolMode: "disabled" | "read-only"): string {
  if (toolMode === "read-only") {
    return "--tools read,grep,find,ls";
  }

  return "--no-tools";
}

function describePiToolMode(toolMode: "disabled" | "read-only"): string {
  if (toolMode === "read-only") {
    return "read-only tools: read, grep, find, ls";
  }

  return "tools disabled";
}

function isPiToolSupportErrorStatus(message: string): boolean {
  return /does not support Pi\/Ollama tool calls/i.test(message);
}

function getVaultGroundingInstructions(): string {
  return [
    "<vault-grounding-instructions>",
    "Use only the Obsidian context blocks supplied in this prompt as authoritative vault/project evidence.",
    "Tool-style context blocks such as Vault search, Related-note search, Safe command output, Fetched URL, and Internal link suggestions are generated by the plugin before the model runs.",
    "Do not invent vault files, sibling files, folder contents, citations, or code paths that are not present in the supplied file contents or directory listings.",
    "When asked what files exist in a folder, answer from the supplied Vault directory listing. If the listing does not include a file, say it is not present in the provided listing.",
    "</vault-grounding-instructions>"
  ].join("\n");
}

function extractPromptToolDirectives(prompt: string): PromptToolDirective[] {
  const directives: PromptToolDirective[] = [];
  for (const match of prompt.matchAll(/@(search|semantic|url|cmd|links)\(([^)]{1,600})\)/gi)) {
    const kind = match[1].toLowerCase() as PromptToolDirective["kind"];
    directives.push({
      kind,
      value: match[2].trim()
    });
  }

  if (/(^|\s)@vault-index(\s|$)/i.test(prompt)) {
    directives.push({ kind: "index", value: "" });
  }

  if (/(^|\s)@links(\s|$)/i.test(prompt)) {
    directives.push({ kind: "links", value: "" });
  }

  return directives;
}

function isKnownPromptToolDirective(value: string): boolean {
  return /^(search|semantic|url|cmd|links)\(/i.test(value) || /^(vault-index|links)$/i.test(value);
}

function formatVaultDirectoryContext(
  referencedFile: TFile,
  loadedFiles: TAbstractFile[]
): string {
  const folderPath = getVaultFolderPath(referencedFile.path);
  const directChildren = loadedFiles
    .filter((item) => item.path !== folderPath)
    .filter((item) => getVaultFolderPath(item.path) === folderPath)
    .sort(compareVaultFiles);
  const folders = directChildren.filter(
    (item): item is TFolder => item instanceof TFolder
  );
  const files = directChildren.filter(
    (item): item is TFile => item instanceof TFile
  );
  const markdownFiles = files.filter((item) => item.extension === "md");
  const otherFiles = files.filter((item) => item.extension !== "md");
  const hiddenCount =
    getOmittedDirectoryItemCount(folders) +
    getOmittedDirectoryItemCount(markdownFiles) +
    getOmittedDirectoryItemCount(otherFiles);

  return [
    `Referenced file: ${referencedFile.path}`,
    `Parent folder: ${formatVaultFolderLabel(folderPath)}`,
    "",
    "Exact direct children currently visible in the vault:",
    formatDirectorySection("Folders", folders.map((item) => item.path)),
    formatDirectorySection("Markdown files", markdownFiles.map((item) => item.path)),
    formatDirectorySection("Other files", otherFiles.map((item) => item.path)),
    hiddenCount > 0
      ? `Additional entries omitted from this listing: ${hiddenCount}`
      : "Additional entries omitted from this listing: 0",
    "",
    "This is a directory listing, not a list of inferred or likely files."
  ].join("\n");
}

function formatDirectorySection(label: string, paths: string[]): string {
  const visiblePaths = paths.slice(0, MAX_DIRECTORY_CONTEXT_ITEMS);
  if (visiblePaths.length === 0) {
    return `${label}:\n- (none)`;
  }

  return [
    `${label}:`,
    ...visiblePaths.map((item) => `- ${item}`)
  ].join("\n");
}

function getOmittedDirectoryItemCount(items: TAbstractFile[]): number {
  return Math.max(0, items.length - MAX_DIRECTORY_CONTEXT_ITEMS);
}

function compareVaultFiles(left: TAbstractFile, right: TAbstractFile): number {
  const leftFolder = left instanceof TFolder;
  const rightFolder = right instanceof TFolder;
  if (leftFolder !== rightFolder) {
    return leftFolder ? -1 : 1;
  }

  return left.path.localeCompare(right.path);
}

function getVaultFolderPath(vaultPath: string): string {
  const folderPath = path.posix.dirname(vaultPath);
  return folderPath === "." ? "" : folderPath;
}

function formatVaultFolderLabel(folderPath: string): string {
  return folderPath || "/";
}

function canReadMentionedFileAsText(file: TFile): boolean {
  return TEXT_CONTEXT_EXTENSIONS.has(file.extension.toLowerCase());
}

function formatMentionedAttachmentContext(file: TFile, warning?: string): string {
  const extension = file.extension || "none";
  const size = Number.isFinite(file.stat.size)
    ? `${file.stat.size.toLocaleString()} bytes`
    : "unknown";

  return [
    `Path: ${file.path}`,
    `Extension: ${extension}`,
    `Size: ${size}`,
    "",
    "This file was referenced from the vault but its contents were not extracted as text.",
    "For PDFs or other binary attachments, do not infer the document contents unless another extracted text context is supplied.",
    warning ? `Warning: ${warning}` : ""
  ].filter(Boolean).join("\n");
}

function getEditProposalInstructions(): string {
  return [
    "<local-sidekick-edit-format>",
    "If you propose changes to vault files, include each full-file replacement in this exact fenced format:",
    "```agent-edit",
    "path: path/inside/vault.md",
    "---",
    "replacement file contents",
    "```",
    "Use this format for reviewed note creation, note updates, frontmatter updates, move/rename notes expressed as replacement files, and conservative internal-linking suggestions.",
    "Do not claim that edits have been applied. The dashboard will show a diff and require approval.",
    "</local-sidekick-edit-format>"
  ].join("\n");
}

function createBlockedToolEvent(event: PiToolEvent): AgentToolEvent {
  return {
    callId: event.callId,
    eventType: event.eventType,
    input: event.input,
    name: event.name,
    output: event.output,
    raw: event.raw,
    status: "blocked",
    title: `Blocked ${event.title}`
  };
}

interface ChatExportOptions {
  exportedAt: string;
  model: string;
  pluginVersion: string;
}

class AgentChatExportModal extends Modal {
  private plugin: AgentDashboardPlugin;

  constructor(app: App, plugin: AgentDashboardPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Export Chat" });
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

function buildChatExportMarkdown(
  record: PersistedAgentSessionRecord,
  options: ChatExportOptions
): string {
  const title = record.title || record.name;
  const lines = [
    "---",
    `title: ${quoteYamlString(title)}`,
    `agent_session: ${quoteYamlString(record.name)}`,
    `exported_at: ${quoteYamlString(options.exportedAt)}`,
    `model: ${quoteYamlString(options.model || "unknown")}`,
    `plugin_version: ${quoteYamlString(options.pluginVersion)}`,
    record.piSessionId
      ? `pi_session_id: ${quoteYamlString(record.piSessionId)}`
      : "",
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

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeChatExportPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Export path cannot be empty.");
  }

  let normalized = path.posix
    .normalize(trimmed.replace(/^\/+/, ""))
    .replace(/^\.\//, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Export path must stay inside the vault.");
  }

  if (!normalized.toLowerCase().endsWith(".md")) {
    normalized = `${normalized}.md`;
  }

  return normalized;
}

function normalizeVaultFolderPath(value: string): string {
  return path.posix
    .normalize(value.replace(/^\/+/, ""))
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function slugifyFileName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 72);

  return slug || "chat";
}

function getPersistedSettings(data: unknown): Partial<AgentDashboardSettings> {
  const record = asPlainRecord(data);
  if (!record) {
    return {};
  }

  if (asPlainRecord(record.settings)) {
    return record.settings as Partial<AgentDashboardSettings>;
  }

  return record as Partial<AgentDashboardSettings>;
}

function getPersistedAgentSession(
  data: unknown
): PersistedAgentSessionState | undefined {
  const record = asPlainRecord(data);
  const session = asPlainRecord(record?.agentSession);
  return session as PersistedAgentSessionState | undefined;
}

function getPersistedAgentSessions(
  data: unknown
): PersistedAgentSessionsState | undefined {
  const record = asPlainRecord(data);
  const sessions = asPlainRecord(record?.agentSessions);
  return sessions as PersistedAgentSessionsState | undefined;
}

function isPersistedAgentSessionRecord(
  value: unknown
): value is PersistedAgentSessionRecord {
  const record = asPlainRecord(value);
  return typeof record?.name === "string" && typeof record.title === "string";
}

function getHistoryItemForSessionRecord(
  record: PersistedAgentSessionRecord
): AgentSessionHistoryItem {
  return {
    createdAt: record.createdAt,
    lastMessage: record.lastMessage ?? getSessionLastMessage(record.events ?? []),
    messageCount:
      record.messageCount ??
      record.piSessionMessageCount ??
      countConversationMessages(record.events ?? []),
    name: record.name,
    piSessionId: record.piSessionId,
    title: record.title,
    updatedAt: record.updatedAt ?? record.createdAt
  };
}

function getSessionTitle(events: AgentEvent[], fallback: string): string {
  const userEvent = events.find((event) => event.kind === "user");
  const title = userEvent?.text.trim() || fallback;
  return truncatePlainText(title, 56);
}

function getSessionLastMessage(events: AgentEvent[]): string {
  const event = [...events]
    .reverse()
    .find((item) => item.kind === "assistant" || item.kind === "user");
  return event ? truncatePlainText(event.text, 96) : "";
}

function countConversationMessages(events: AgentEvent[]): number {
  return events.filter(
    (event) => event.kind === "assistant" || event.kind === "user"
  ).length;
}

function truncatePlainText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 3, 0))}...`;
}

function normalizeSettings(
  settings: AgentDashboardSettings
): AgentDashboardSettings {
  return {
    ...settings,
    agentSessionName:
      settings.agentSessionName?.trim() || DEFAULT_SETTINGS.agentSessionName,
    ollamaHost: settings.ollamaHost?.trim() || DEFAULT_SETTINGS.ollamaHost,
    piExecutablePath:
      settings.piExecutablePath?.trim() || DEFAULT_SETTINGS.piExecutablePath,
    piPromptTimeoutMinutes: normalizePiPromptTimeout(
      settings.piPromptTimeoutMinutes
    ),
    piToolMode: settings.piToolMode === "read-only" ? "read-only" : "disabled",
    safeCommandAllowlist:
      settings.safeCommandAllowlist ?? DEFAULT_SETTINGS.safeCommandAllowlist,
    webFetchAllowedHosts:
      settings.webFetchAllowedHosts ?? DEFAULT_SETTINGS.webFetchAllowedHosts,
    webFetchEnabled: settings.webFetchEnabled === true
  };
}

function normalizePiPromptTimeout(value: unknown): number {
  const timeout = typeof value === "number" ? value : DEFAULT_SETTINGS.piPromptTimeoutMinutes;
  if (!Number.isFinite(timeout)) {
    return DEFAULT_SETTINGS.piPromptTimeoutMinutes;
  }

  return Math.min(30, Math.max(2, Math.round(timeout)));
}

function createAgentSessionName(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, "")
    .replace(/[^\dT]/g, "")
    .replace("T", "-");

  return `session-${stamp}`;
}

function sanitizeSessionFileName(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || DEFAULT_SETTINGS.agentSessionName;
}

function getMaxIdCounter(records: { id: string }[], prefix: string): number {
  return records.reduce((max, record) => {
    if (!record.id.startsWith(prefix)) {
      return max;
    }

    const value = Number(record.id.slice(prefix.length));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function limitContextText(value: string): string {
  if (value.length <= MAX_CONTEXT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_CONTEXT_CHARS)}\n\n[Context truncated to ${MAX_CONTEXT_CHARS.toLocaleString()} characters.]`;
}

function normalizeProposedEditPath(value: string): string {
  const normalized = path.posix
    .normalize(value.replace(/^["']|["']$/g, "").replace(/^\/+/, "").trim())
    .replace(/^\.\//, "");

  if (
    !normalized ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return "";
  }

  return normalized;
}

function extractMentionedVaultFileReferences(
  prompt: string,
  files: TFile[]
): MentionedVaultFileReference[] {
  const references: MentionedVaultFileReference[] = [];
  const seenFiles = new Set<string>();
  const candidates = files
    .flatMap((file) =>
      getMentionedPathCandidates(file.path).map((candidate) => ({
        candidate,
        file
      }))
    )
    .sort((a, b) => b.candidate.length - a.candidate.length);

  for (const { candidate, file } of candidates) {
    if (seenFiles.has(file.path)) {
      continue;
    }

    const mention = `@${candidate}`;
    let start = prompt.indexOf(mention);

    while (start !== -1) {
      const end = start + mention.length;
      if (
        isMentionBoundary(prompt, start, end) &&
        !references.some((reference) => rangesOverlap(reference, { start, end }))
      ) {
        references.push({
          end,
          file,
          mention: candidate,
          start
        });
        seenFiles.add(file.path);
        break;
      }

      start = prompt.indexOf(mention, start + 1);
    }
  }

  for (const match of prompt.matchAll(/@\[\[([^\]]+)\]\]/g)) {
    if (match.index === undefined) {
      continue;
    }

    const start = match.index;
    const end = start + match[0].length;
    if (references.some((reference) => rangesOverlap(reference, { start, end }))) {
      continue;
    }

    const file = resolveWikiLinkFile(match[1], files);
    if (!file || seenFiles.has(file.path)) {
      continue;
    }

    references.push({
      end,
      file,
      mention: `[[${match[1]}]]`,
      start
    });
    seenFiles.add(file.path);
  }

  return references.sort((a, b) => a.start - b.start);
}

function extractUnresolvedMentionedVaultPaths(
  prompt: string,
  resolvedReferences: MentionedVaultFileReference[]
): string[] {
  const matches = prompt.matchAll(/(^|\s)@([^\s@]+)/g);
  const paths: string[] = [];
  const seenPaths = new Set<string>();

  for (const match of matches) {
    if (match.index === undefined) {
      continue;
    }

    const start = match.index + match[1].length;
    const end = start + match[0].length - match[1].length;
    if (
      resolvedReferences.some((reference) =>
        rangesOverlap(reference, { start, end })
      )
    ) {
      continue;
    }

    const rawPath = normalizeMentionedPath(match[2]);
    if (!rawPath || isKnownPromptToolDirective(rawPath) || seenPaths.has(rawPath)) {
      continue;
    }

    seenPaths.add(rawPath);
    paths.push(rawPath);
  }

  return paths;
}

function normalizeMentionedPath(value: string): string {
  return value
    .replace(/[),.;:!?]+$/, "")
    .replace(/^\/+/, "")
    .trim();
}

function resolveWikiLinkFile(value: string, files: TFile[]): TFile | undefined {
  const target = value
    .split("|")[0]
    .split("#")[0]
    .replace(/^\/+/, "")
    .trim();
  if (!target) {
    return undefined;
  }

  const candidates = getMentionedPathCandidates(target);
  return files.find((file) => {
    const withoutExtension = stripVaultFileExtension(file.path);
    const basename = path.basename(withoutExtension);
    return candidates.some(
      (candidate) =>
        file.path === candidate ||
        withoutExtension === candidate ||
        basename === candidate
    );
  });
}

function getMentionedPathCandidates(mentionedPath: string): string[] {
  const candidates = [mentionedPath];
  const extension = path.extname(mentionedPath);

  if (!extension) {
    candidates.push(`${mentionedPath}.md`);
    candidates.push(`${mentionedPath}.pdf`);
  } else {
    candidates.push(stripVaultFileExtension(mentionedPath));
  }

  return Array.from(new Set(candidates));
}

function stripVaultFileExtension(vaultPath: string): string {
  const extension = path.extname(vaultPath);
  return extension ? vaultPath.slice(0, -extension.length) : vaultPath;
}

function isMentionBoundary(prompt: string, start: number, end: number): boolean {
  const before = prompt[start - 1];
  const after = prompt[end];
  const validBefore = before === undefined || /\s|[([{]/.test(before);
  const validAfter = after === undefined || /\s|[),.;:!?}\]]/.test(after);

  return validBefore && validAfter;
}

function rangesOverlap(
  left: { end: number; start: number },
  right: { end: number; start: number }
): boolean {
  return left.start < right.end && right.start < left.end;
}

function scoreVaultFileSuggestion(filePath: string, query: string): number {
  if (!query) {
    return 10;
  }

  const normalizedPath = filePath.toLowerCase();
  const fileName = path.basename(normalizedPath);

  if (normalizedPath === query) {
    return 0;
  }

  if (normalizedPath.startsWith(query)) {
    return 1;
  }

  if (fileName.startsWith(query)) {
    return 2;
  }

  if (normalizedPath.includes(query)) {
    return 3;
  }

  if (isFuzzyMatch(normalizedPath, query)) {
    return 4;
  }

  return Number.POSITIVE_INFINITY;
}

function isFuzzyMatch(value: string, query: string): boolean {
  let queryIndex = 0;
  for (const char of value) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
    }

    if (queryIndex === query.length) {
      return true;
    }
  }

  return false;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
