import path from "path";

export type SafetyActionKind =
  | "approved-write"
  | "delete"
  | "diagnostic"
  | "prompt"
  | "read"
  | "safe-command"
  | "shell"
  | "write";

export type SafetyMode = "read-only" | "reviewed-edits";

export interface SafetyRequest {
  kind: SafetyActionKind;
  command?: string;
  description?: string;
  targetPath?: string;
}

export interface SafetyDecision {
  allowed: boolean;
  reason: string;
  request: SafetyRequest;
  requiresApproval: boolean;
}

export interface SafetySnapshot {
  allowedRoots: string[];
  mode: SafetyMode;
  pendingApprovals: number;
  vaultRoot?: string;
}

export function assessSafetyRequest(
  snapshot: SafetySnapshot,
  request: SafetyRequest
): SafetyDecision {
  if (request.kind === "diagnostic") {
    return {
      allowed: true,
      reason: "Read-only mode allows manual diagnostic probes.",
      request,
      requiresApproval: false
    };
  }

  if (request.kind === "prompt") {
    const command = request.command ?? "";
    if (usesNoTools(command)) {
      return {
        allowed: true,
        reason: "Prompt run has Pi tools disabled.",
        request,
        requiresApproval: false
      };
    }

    if (usesOnlyReadOnlyPiTools(command)) {
      return {
        allowed: true,
        reason: "Prompt run only enables Pi read-only tools.",
        request,
        requiresApproval: false
      };
    }

    return deny(
      snapshot,
      request,
      "Pi prompts only allow tools disabled or the read-only tool allowlist: read, grep, find, ls."
    );
  }

  if (request.kind === "approved-write") {
    if (!request.targetPath) {
      return deny(snapshot, request, "Approved writes must include a target path.");
    }

    if (!isPathInsideAnyRoot(request.targetPath, snapshot.allowedRoots)) {
      return deny(snapshot, request, "Path is outside the allowed workspace roots.");
    }

    return {
      allowed: true,
      reason: "Reviewed edit mode allows approved writes inside allowed roots.",
      request,
      requiresApproval: false
    };
  }

  if (request.kind === "safe-command") {
    if (!request.command) {
      return deny(snapshot, request, "Safe commands must include a command.");
    }

    return {
      allowed: true,
      reason: "Command matched the plugin safe command allowlist.",
      request,
      requiresApproval: false
    };
  }

  if (request.kind === "shell") {
    return deny(snapshot, request, "Read-only mode blocks shell commands.");
  }

  if (request.kind === "write") {
    return deny(snapshot, request, "Read-only mode blocks file writes.");
  }

  if (request.kind === "delete") {
    return deny(snapshot, request, "Read-only mode blocks file deletes.");
  }

  if (!request.targetPath) {
    return deny(snapshot, request, "Read requests must include a target path.");
  }

  if (!isPathInsideAnyRoot(request.targetPath, snapshot.allowedRoots)) {
    return deny(snapshot, request, "Path is outside the allowed workspace roots.");
  }

  return {
    allowed: true,
    reason: "Read-only request is inside an allowed workspace root.",
    request,
    requiresApproval: false
  };
}

export function parseExternalRoots(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => path.resolve(line));
}

export function summarizeAllowedRoots(snapshot: SafetySnapshot): string {
  const externalCount = snapshot.vaultRoot
    ? Math.max(snapshot.allowedRoots.length - 1, 0)
    : snapshot.allowedRoots.length;

  if (snapshot.vaultRoot && externalCount > 0) {
    return `vault + ${externalCount} external`;
  }

  if (snapshot.vaultRoot) {
    return "vault only";
  }

  if (externalCount > 0) {
    return `${externalCount} external`;
  }

  return "none configured";
}

function deny(
  snapshot: SafetySnapshot,
  request: SafetyRequest,
  reason: string
): SafetyDecision {
  return {
    allowed: false,
    reason,
    request,
    requiresApproval: snapshot.mode !== "read-only"
  };
}

function usesNoTools(command: string): boolean {
  const paddedCommand = ` ${command} `;
  return (
    /\s(--no-tools|-nt)(\s|$)/.test(paddedCommand) &&
    !/\s(--tools|-t)\s+/.test(paddedCommand)
  );
}

function usesOnlyReadOnlyPiTools(command: string): boolean {
  const matches = [...` ${command} `.matchAll(/\s(?:--tools|-t)\s+([^\s]+)/g)];
  if (matches.length !== 1) {
    return false;
  }

  const allowedTools = new Set(["find", "grep", "ls", "read"]);
  const requestedTools = matches[0][1]
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);

  return (
    requestedTools.length > 0 &&
    requestedTools.every((tool) => allowedTools.has(tool))
  );
}

function isPathInsideAnyRoot(targetPath: string, roots: string[]): boolean {
  const resolvedTarget = path.resolve(targetPath);

  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relativePath = path.relative(resolvedRoot, resolvedTarget);

    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
  });
}
