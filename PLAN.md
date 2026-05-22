# Obsidian Agent Dashboard Plugin Plan

## Goal

Build an Obsidian desktop plugin that can render an agentic coding dashboard inside an Obsidian vault, especially inside a Dashboard++ style note, while also offering a standalone right-sidebar view. The dashboard should connect to local Ollama-backed coding agents through the `pi.dev` agentic harness while normal Obsidian panes continue to handle vault file viewing and editing.

The core product should feel like a local coding cockpit inside Obsidian:

- Agent chat and tool timeline powered by Pi.
- Ollama model status and model selection.
- Project/vault context picker.
- Right-sidebar layout that keeps the main Obsidian editor and left sidebar available.
- Native Obsidian editing for vault files.
- Optional separate terminal plugin usage instead of an embedded terminal panel.
- Compatibility with Dashboard++ style Markdown dashboards.

## Current Implementation Status

Completed so far:

- Minimal Obsidian plugin scaffold.
- Standalone Agent Dashboard view.
- `agent-dashboard` Markdown code block renderer for Dashboard++ style notes.
- Settings tab for early Pi, Ollama, permission, and bridge options.
- Scoped dashboard CSS.
- Localhost bridge health stub launched by the plugin.
- Dashboard controls to start, stop, and restart the bridge.
- Right-sidebar dashboard layout with only Status and Agent panels.
- Ollama health/model query helper.
- Status panel Ollama check control and model summary.
- Interactive Agent panel with prompt input, send/stop/clear controls, and mock event stream.
- Locked read-only safety mode.
- Workspace allowlist based on vault root plus optional external roots.
- Safety decision guard for read, shell, write, and delete requests.
- Safety self-check command and local audit counter.
- Manual Pi executable probe using `execFile`, no shell, short timeout, and no session start.
- Status panel Pi check control and Pi probe summary.
- Approval queue scaffold inside the Agent panel.
- Approve/deny controls that record decisions but do not execute actions.
- Read-only Pi RPC discovery probe using JSONL commands `get_state` and `get_available_models`.
- Manual RPC status check with diagnostic safety audit entries.

Not implemented yet:

- Pi RPC session management.
- Real streamed agent/tool events.
- Approval execution path after read-only mode is lifted.

## Reference Compatibility Target

The dashboard compatibility target is the Dashboard++ method described in the Obsidian forum thread:

- https://forum.obsidian.md/t/dashboard-a-simple-organization-and-navigation-method-for-obsidian-vaults/33197

This is not a normal plugin API dependency. Dashboard++ is mainly a dashboard note pattern using Markdown, CSS snippets, reading mode, and sometimes helper classes from themes such as Minimal. That means our plugin should integrate by rendering cleanly inside Markdown rather than by depending on another plugin.

Practical compatibility implications:

- Provide a Markdown code block renderer that works in Reading view.
- Keep the embedded dashboard responsive inside multi-column dashboard layouts.
- Avoid global CSS leakage into the rest of the vault.
- Support frontmatter-driven dashboard pages, for example `cssclasses: dashboard` or `cssclasses: [dashboard, max]`.
- Make the embedded view usable in a narrow dashboard column, but allow full-width expansion.
- Provide a standalone view for serious agent work when the dashboard cell is too small.
- Do not require Dashboard++ users to change their dashboard structure beyond adding a code block.

Example embedded dashboard block:

````md
```agent-dashboard
workspace: vault
mode: compact
session: default
```
````

Example full-width dashboard block:

````md
```agent-dashboard
workspace: /Users/example/dev/project
mode: full
layout: agent-sidebar
model: qwen2.5-coder:latest
```
````

## Terminal Strategy

The current product direction is to run terminal functionality separately, for example with an Obsidian terminal community plugin that opens at the bottom of the workspace. The Agent Dashboard itself should stay focused on status and agent interaction in the right sidebar.

Obsidian itself should not be treated as having a stable public core terminal API unless a documented API is confirmed for the target version. There are, however, community terminal plugins, especially the Terminal plugin:

- Community plugin page: https://community.obsidian.md/plugins/terminal
- Source repository: https://github.com/polyipseity/obsidian-terminal

That plugin exposes terminal-related behavior and has an API type file according to its docs. It also uses integrated terminal concepts, multiple profiles, keyboard handling, and xterm.js configuration. The source repository is AGPL-3.0, so copying code from it would likely impose AGPL obligations on this project. Runtime integration through a supported API is much safer than scavenging private implementation.

Recommended terminal approach:

1. Treat external terminal plugins as separate tools the user can run alongside the dashboard.
2. Do not import, bundle, or copy a terminal plugin implementation unless this project intentionally adopts a compatible license.
3. Keep the Agent Dashboard UI free of terminal panels.
4. Keep the bridge focused on Pi, Ollama, health, and future agent orchestration.

## Architecture

Use a two-process architecture.

### 1. Obsidian Plugin

Responsibilities:

- Register the standalone `AgentDashboardView`.
- Register Markdown code block processors for Dashboard++ embedding.
- Provide settings UI.
- Read vault context through Obsidian APIs.
- Open and edit notes through Obsidian workspace APIs.
- Render the dashboard UI.
- Display Pi events, Ollama status, and agent session state.
- Enforce UI-level confirmation flows.

Likely source modules:

- `src/main.ts`: plugin lifecycle, commands, settings, view registration.
- `src/settings.ts`: settings schema and settings tab.
- `src/views/AgentDashboardView.ts`: standalone dashboard view.
- `src/markdown/agentDashboardBlock.ts`: code block renderer.
- `src/ui/*`: dashboard components.
- `src/obsidian/vaultContext.ts`: current note, selection, folder, backlinks, search helpers.
- `src/bridge/client.ts`: bridge connection and RPC client.
- `src/security/permissions.ts`: user-facing permission checks.

### 2. Local Bridge Service

Responsibilities:

- Launch and supervise `pi`.
- Connect to Pi RPC mode.
- Stream Pi events to the Obsidian plugin.
- Query Ollama health and models.
- Apply workspace allowlist checks before touching files or running commands.
- Keep logs outside the Obsidian renderer.

Likely source modules:

- `bridge/server.ts`: HTTP/WebSocket server lifecycle.
- `bridge/pi/rpcClient.ts`: Pi JSONL/RPC transport.
- `bridge/pi/sessionManager.ts`: create, resume, stop, compact sessions.
- `src/bridge/ollama/OllamaClient.ts`: health check, model list, version check.
- `bridge/security/workspacePolicy.ts`: path and command policy.
- `bridge/logging.ts`: event logs and diagnostics.

Transport:

- Localhost WebSocket for streaming events.
- Localhost HTTP endpoint for health checks and one-shot operations.
- Random per-session auth token generated by the plugin and passed to the bridge.
- Bind only to `127.0.0.1` by default.

## Pi Integration

Pi is the agent harness and should be the primary agent runtime rather than implementing tool orchestration ourselves.

References:

- Usage docs: https://pi.dev/docs/latest/usage
- RPC docs: https://pi.dev/docs/latest/rpc
- Ollama integration: https://docs.ollama.com/integrations/pi

Preferred integration:

- Start Pi in RPC mode, for example `pi --mode rpc`.
- Communicate via structured JSONL/RPC rather than terminal scraping.
- Stream structured events into the UI:
  - Assistant output.
  - User messages.
  - Tool calls.
  - Tool results.
  - File diffs.
  - Bash output.
  - Permission requests.
  - Errors and session state.

Required Pi capabilities:

- Create a new session in a selected workspace.
- Resume an existing session.
- Send user prompts.
- Stop/cancel a running turn.
- Surface tool calls and tool results.
- Support model/provider selection for Ollama.
- Expose or infer pending approval requests.

Fallback if RPC is insufficient:

- Launch Pi in a terminal-style process and parse output only for display.
- Keep this fallback as a compatibility mode, not the core design.

## Ollama Integration

Responsibilities:

- Detect whether Ollama is running.
- Show installed local models.
- Verify that Pi can use the selected Ollama model.
- Surface model loading errors clearly.
- Offer settings for host, model, context length, and default model.

Default host:

- `http://127.0.0.1:11434`

Bridge endpoints:

- `GET /ollama/health`
- `GET /ollama/models`
- `POST /ollama/pull` as a later optional feature.

UI states:

- Running.
- Not reachable.
- No models installed.
- Selected model unavailable.
- Pi provider misconfigured.

## Obsidian Vault Integration

Use Obsidian APIs for vault-aware operations whenever possible.

Core context actions:

- Add current note to agent context.
- Add selected text to agent context.
- Add active folder tree to context.
- Add search results to context.
- Add backlinks/outlinks for the active note.
- Open file references produced by the agent.
- Apply a proposed Markdown edit through a review step.

Editing model:

- Let users edit notes in normal Obsidian panes.
- Use the plugin UI for agent suggestions, diffs, and approvals.
- Apply vault file changes through Obsidian APIs such as `Vault.process()` where practical.
- Use direct bridge filesystem edits only for external project roots outside the vault.

Important distinction:

- Vault files should be treated as Obsidian-managed content.
- External code projects should be treated as normal filesystem workspaces.

## Dashboard UI

The standalone view should support a full agent workflow. The embedded Dashboard++ block should support compact modes and deep-link to the standalone view.

Primary panels:

- Status.
- Agent chat and tool/event timeline.

Controls inside those panels:

- Model/session controls.
- Permission queue.

Layouts:

- `compact`: status plus agent, for dashboard columns.
- `agent-sidebar`: right-sidebar status plus agent layout.
- `status`: small dashboard widget for active session state.

Embedded mode rules:

- Use bounded height with resize controls.
- Avoid modal-heavy flows in tiny cards.
- Provide an "open full dashboard" button.
- Avoid layout shifts when streamed text arrives.
- Work in Reading view.
- Support Live Preview only if feasible through a separate CodeMirror extension; do not block MVP on this.

Standalone mode rules:

- Use an Obsidian workspace leaf.
- Support multiple sessions through tabs or a session switcher.
- Preserve session state across Obsidian restarts.
- Offer keyboard shortcuts, but avoid stealing Obsidian hotkeys while the user is editing notes.

## Security And Permissions

This plugin combines agentic tools, shell commands, and file writes. Permission design is not optional.

Workspace policy:

- Default allowed root is the current vault.
- Additional external project roots must be explicitly added.
- Normalize and resolve paths before allowing reads/writes.
- Block path traversal outside allowed roots.
- Show clear labels for vault root vs external project root.

Command policy:

- Configurable modes:
  - Ask every time.
  - Allow read-only commands.
  - Allow project-local commands.
  - Fully trusted for selected workspace.
- Always ask for destructive commands unless the user explicitly disables prompts.
- Maintain a denylist for obviously risky commands.
- Log command, working directory, timestamp, and agent session.

File write policy:

- Show diffs before applying changes when possible.
- Confirm writes to vault notes by default.
- Confirm writes outside the vault by default.
- Block writes outside allowed roots.
- Preserve Obsidian metadata and frontmatter formatting where possible.

Network policy:

- Bind bridge to localhost.
- Use a generated auth token.
- Never expose bridge to LAN by default.
- Redact secrets from logs where possible.

## Settings

Suggested settings:

- Pi executable path.
- Pi config directory.
- Pi default mode: RPC.
- Ollama host.
- Default Ollama model.
- Default workspace.
- Allowed external workspace roots.
- Permission mode.
- Log level.
- Session retention policy.
- Dashboard block default layout.
- Compact block height.
- Open full dashboard command behavior.

## Commands

Obsidian command palette commands:

- Open Agent Dashboard.
- Insert Agent Dashboard Block.
- Start Agent Session.
- Stop Current Agent Session.
- Send Current Note to Agent.
- Send Selection to Agent.
- Explain Current Note.
- Propose Edit for Current Note.
- Check Ollama Status.
- Restart Local Bridge.

Context menu actions:

- Ask agent about this file.
- Ask agent about this folder.
- Open project dashboard here.
- Add to active agent context.

## Data Model

Plugin settings:

```ts
interface AgentDashboardSettings {
  piExecutablePath: string;
  piConfigDir?: string;
  ollamaHost: string;
  defaultModel?: string;
  allowedWorkspaceRoots: string[];
  defaultWorkspaceMode: "vault" | "external";
  permissionMode: "ask" | "read-only-auto" | "project-trusted" | "trusted";
  compactBlockHeight: number;
  logLevel: "error" | "warn" | "info" | "debug";
}
```

Session summary:

```ts
interface AgentSessionSummary {
  id: string;
  title: string;
  workspaceRoot: string;
  model?: string;
  provider: "ollama" | "other";
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "needs-approval" | "error" | "stopped";
}
```

Bridge event:

```ts
type BridgeEvent =
  | { type: "session.status"; sessionId: string; status: string }
  | { type: "agent.text"; sessionId: string; text: string }
  | { type: "tool.call"; sessionId: string; callId: string; name: string; input: unknown }
  | { type: "tool.result"; sessionId: string; callId: string; output: unknown }
  | { type: "permission.request"; requestId: string; payload: PermissionRequest }
  | { type: "error"; message: string; detail?: unknown };
```

## Build Milestones

### Milestone 1: Plugin Scaffold

Deliverables:

- TypeScript Obsidian plugin scaffold.
- Build pipeline.
- `manifest.json`, `main.ts`, `styles.css`.
- Settings tab skeleton.
- Command to open a placeholder `AgentDashboardView`.
- Manual install instructions for a test vault.

Acceptance criteria:

- Plugin builds.
- Plugin loads in Obsidian.
- Command opens a dashboard leaf.
- Settings persist across restart.

### Milestone 2: Dashboard++ Embedding

Deliverables:

- `agent-dashboard` Markdown code block renderer.
- Compact embedded widget.
- "Open full dashboard" action.
- Scoped styles that behave inside dashboard columns.

Acceptance criteria:

- A Dashboard++ note can embed the widget in Reading view.
- The widget does not break multi-column dashboard layout.
- The widget remains usable at narrow widths.
- The standalone view opens from the embedded widget.

### Milestone 3: Bridge Service

Deliverables:

- Local bridge process launched by plugin.
- Health endpoint.
- Auth token.
- WebSocket event stream.
- Bridge restart command.
- Basic logs.

Acceptance criteria:

- Plugin can start, stop, and reconnect to bridge.
- Bridge binds to localhost only.
- UI displays bridge status.
- Failure states are visible and recoverable.

### Milestone 4: Ollama Status

Deliverables:

- Ollama health check.
- Model listing.
- Default model setting.
- UI status indicator.

Acceptance criteria:

- UI shows whether Ollama is reachable.
- UI lists installed models.
- Missing model is clearly reported.

### Milestone 5: Pi RPC Session

Deliverables:

- Start Pi in RPC mode.
- Create/send/stop session.
- Stream agent text and tool events.
- Session picker.

Acceptance criteria:

- User can start a Pi-backed local agent session.
- User can send a prompt from Obsidian.
- Agent response streams into the dashboard.
- Errors and process exits are shown in the UI.

### Milestone 6: Native Editor Context Actions

Deliverables:

- Current note context.
- Selection context.
- Folder context.
- Open file references.
- Apply Markdown edit with confirmation.

Acceptance criteria:

- Agent can receive active note or selection.
- Agent can reference vault files.
- User can open referenced notes from the event stream.
- Vault writes require review by default.
- No separate Vault Context panel is added to the right-sidebar dashboard.

### Milestone 7: External Terminal Compatibility

Deliverables:

- Document recommended external terminal plugin setup.
- Keep dashboard layout compatible with a bottom terminal pane.
- Avoid capturing terminal-related hotkeys in the right sidebar.

Acceptance criteria:

- User can run a separate terminal plugin below the editor while Agent Dashboard remains in the right sidebar.
- Agent Dashboard does not reserve UI space for terminal controls.
- Agent Dashboard remains readable when the editor area is partially covered by a bottom terminal.

### Milestone 8: Permission System

Deliverables:

- Permission request UI.
- Command approval flow.
- File write approval flow.
- Workspace allowlist enforcement.
- Audit log.

Acceptance criteria:

- Agent cannot write outside allowed roots.
- Agent cannot run commands silently unless configured.
- User sees exactly what is being approved.
- Denied actions return useful feedback to Pi.

### Milestone 9: Polish And Packaging

Deliverables:

- Better layouts.
- Theme compatibility pass.
- Error recovery.
- Documentation.
- Release packaging.

Acceptance criteria:

- Works in a clean test vault.
- Works in a Dashboard++ note.
- Works with default Obsidian theme and common themes.
- Has clear setup docs for Pi and Ollama.

## Testing Plan

Unit tests:

- Settings migration.
- Workspace allowlist path checks.
- Bridge protocol message parsing.
- Pi event normalization.
- Ollama response parsing.

Integration tests:

- Bridge starts and responds to health checks.
- WebSocket reconnect works.
- Pi process lifecycle works with a mocked Pi executable.
- Vault context extraction works with fixture notes.

Manual Obsidian QA:

- Load plugin in a test vault.
- Open standalone dashboard.
- Embed block in a Dashboard++ note.
- Test narrow dashboard column.
- Test full-width dashboard page.
- Test default theme and Minimal theme.
- Test Ollama unavailable.
- Test Pi unavailable.
- Test permission denial.
- Test Obsidian restart while session exists.

## Known Risks

- Pi RPC API behavior may change or may not expose every event needed for a rich UI.
- Obsidian plugin sandboxing and Electron behavior can vary across versions.
- Optional terminal plugin behavior can vary by user setup.
- Dashboard++ layouts are CSS/theme-dependent, so embedded UI must be defensive.
- Agentic file writes can damage a vault without a strong approval model.
- Mobile Obsidian should be considered unsupported for terminal and local agent execution.

## Early Technical Decisions

- Build for desktop Obsidian first.
- Keep Dashboard++ integration Markdown-first.
- Use Pi RPC as the main agent transport.
- Keep terminal functionality outside the dashboard for now.
- Do not copy code from AGPL terminal projects unless the project license decision allows it.
- Keep a local bridge service for Pi, Ollama, status, and future agent orchestration.
- Use Obsidian APIs for vault files.
- Use direct filesystem access only for explicit external project workspaces.
- Treat security and permission prompts as MVP, not polish.

## Open Questions

- What license should this plugin use?
- Should external project roots be allowed by default, or should the first version be vault-only?
- Should the UI be implemented with vanilla TypeScript, Svelte, React, or another small framework?
- Which Pi event schema is stable enough to target first?
- How much of the agent file diff flow should be custom, versus delegating edits entirely to Pi?
- Should the plugin store session summaries in plugin data or in vault-visible Markdown/JSON files?
- Should the plugin ever coordinate with an external terminal plugin, or should it remain fully separate?

## MVP Definition

The first useful version is:

- Standalone Agent Dashboard view.
- Dashboard++ compatible Markdown code block.
- Bridge process with health and logs.
- Ollama status and model list.
- Pi RPC chat session.
- Active note and selection context.
- Explicit approval before file writes or shell commands.

Everything else can come after the system proves it can run a local Ollama-backed Pi session inside an Obsidian dashboard note without making the vault feel fragile.
