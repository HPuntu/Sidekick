import { describe, expect, it } from "vitest";
import path from "path";

import {
  assessSafetyRequest,
  isPathInsideAnyRoot,
  parseExternalRoots,
  summarizeAllowedRoots
} from "../src/security/SafetyPolicy";
import type { SafetySnapshot } from "../src/security/SafetyPolicy";

const vaultRoot = path.resolve("/vaults/notes");

function snapshot(overrides: Partial<SafetySnapshot> = {}): SafetySnapshot {
  return {
    allowedRoots: [vaultRoot],
    mode: "read-only",
    pendingApprovals: 0,
    vaultRoot,
    ...overrides
  };
}

describe("isPathInsideAnyRoot", () => {
  it("accepts the root itself and paths beneath it", () => {
    expect(isPathInsideAnyRoot(vaultRoot, [vaultRoot])).toBe(true);
    expect(isPathInsideAnyRoot(path.join(vaultRoot, "a/b.md"), [vaultRoot])).toBe(true);
  });

  it("rejects traversal out of the root", () => {
    expect(
      isPathInsideAnyRoot(path.join(vaultRoot, "../secrets.md"), [vaultRoot])
    ).toBe(false);
    expect(isPathInsideAnyRoot(path.resolve("/etc/passwd"), [vaultRoot])).toBe(false);
  });

  it("does not treat a sibling with a shared prefix as inside", () => {
    expect(
      isPathInsideAnyRoot(path.resolve("/vaults/notes-backup/a.md"), [vaultRoot])
    ).toBe(false);
  });

  it("rejects everything when no roots are configured", () => {
    expect(isPathInsideAnyRoot(path.join(vaultRoot, "a.md"), [])).toBe(false);
  });
});

describe("assessSafetyRequest", () => {
  it("blocks shell, write, and delete in read-only mode", () => {
    for (const kind of ["shell", "write", "delete"] as const) {
      expect(assessSafetyRequest(snapshot(), { kind }).allowed).toBe(false);
    }
  });

  it("allows reads inside an allowed root and blocks reads outside", () => {
    expect(
      assessSafetyRequest(snapshot(), {
        kind: "read",
        targetPath: path.join(vaultRoot, "note.md")
      }).allowed
    ).toBe(true);

    expect(
      assessSafetyRequest(snapshot(), {
        kind: "read",
        targetPath: path.resolve("/etc/passwd")
      }).allowed
    ).toBe(false);
  });

  it("blocks a read with no target path", () => {
    expect(assessSafetyRequest(snapshot(), { kind: "read" }).allowed).toBe(false);
  });

  it("decides prompt runs from toolMode, not the command string", () => {
    expect(
      assessSafetyRequest(snapshot(), { kind: "prompt", toolMode: "disabled" }).allowed
    ).toBe(true);
    expect(
      assessSafetyRequest(snapshot(), { kind: "prompt", toolMode: "read-only" }).allowed
    ).toBe(true);
  });

  it("blocks a prompt run with no toolMode, however the command reads", () => {
    const decision = assessSafetyRequest(snapshot(), {
      kind: "prompt",
      command: "pi --mode rpc --no-tools"
    });
    expect(decision.allowed).toBe(false);
  });

  it("blocks approved writes outside the allowed roots", () => {
    const reviewed = snapshot({ mode: "reviewed-edits" });
    expect(
      assessSafetyRequest(reviewed, {
        kind: "approved-write",
        targetPath: path.join(vaultRoot, "note.md")
      }).allowed
    ).toBe(true);
    expect(
      assessSafetyRequest(reviewed, {
        kind: "approved-write",
        targetPath: path.resolve("/tmp/note.md")
      }).allowed
    ).toBe(false);
    expect(
      assessSafetyRequest(reviewed, { kind: "approved-write" }).allowed
    ).toBe(false);
  });

  it("only requires approval outside read-only mode", () => {
    expect(assessSafetyRequest(snapshot(), { kind: "shell" }).requiresApproval).toBe(
      false
    );
    expect(
      assessSafetyRequest(snapshot({ mode: "reviewed-edits" }), { kind: "shell" })
        .requiresApproval
    ).toBe(true);
  });
});

describe("parseExternalRoots", () => {
  it("ignores blanks and comments and resolves the rest", () => {
    expect(
      parseExternalRoots(["", "# comment", "  /a/b  ", "/c"].join("\n"))
    ).toEqual([path.resolve("/a/b"), path.resolve("/c")]);
  });
});

describe("summarizeAllowedRoots", () => {
  it("describes each combination of vault and external roots", () => {
    expect(summarizeAllowedRoots(snapshot())).toBe("vault only");
    expect(
      summarizeAllowedRoots(snapshot({ allowedRoots: [vaultRoot, "/x", "/y"] }))
    ).toBe("vault + 2 external");
    expect(
      summarizeAllowedRoots(snapshot({ allowedRoots: ["/x"], vaultRoot: undefined }))
    ).toBe("1 external");
    expect(
      summarizeAllowedRoots(snapshot({ allowedRoots: [], vaultRoot: undefined }))
    ).toBe("none configured");
  });
});
