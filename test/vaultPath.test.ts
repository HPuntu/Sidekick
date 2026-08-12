import { describe, expect, it } from "vitest";

import {
  formatVaultFolderLabel,
  getVaultFolderPath,
  normalizeChatExportPath,
  normalizeProposedEditPath,
  normalizeVaultFolderPath,
  slugifyFileName,
  stripVaultFileExtension
} from "../src/util/vaultPath";

describe("getVaultFolderPath", () => {
  it("returns the parent folder, or empty at the vault root", () => {
    expect(getVaultFolderPath("a/b/c.md")).toBe("a/b");
    expect(getVaultFolderPath("c.md")).toBe("");
  });
});

describe("formatVaultFolderLabel", () => {
  it("shows the vault root as a slash", () => {
    expect(formatVaultFolderLabel("")).toBe("/");
    expect(formatVaultFolderLabel("a/b")).toBe("a/b");
  });
});

describe("stripVaultFileExtension", () => {
  it("removes only the final extension", () => {
    expect(stripVaultFileExtension("a/b.tar.gz")).toBe("a/b.tar");
    expect(stripVaultFileExtension("a/b")).toBe("a/b");
  });
});

describe("normalizeProposedEditPath", () => {
  it("normalises leading slashes, quotes, and dot segments", () => {
    expect(normalizeProposedEditPath('"/a/./b.md"')).toBe("a/b.md");
    expect(normalizeProposedEditPath("  a/b.md  ")).toBe("a/b.md");
  });

  it("returns empty for anything escaping the vault", () => {
    for (const value of ["../secrets.md", "a/../../secrets.md", "", ".", "/"]) {
      expect(normalizeProposedEditPath(value)).toBe("");
    }
  });
});

describe("normalizeChatExportPath", () => {
  it("appends .md when missing and strips leading slashes", () => {
    expect(normalizeChatExportPath("/Chats/today")).toBe("Chats/today.md");
    expect(normalizeChatExportPath("Chats/today.MD")).toBe("Chats/today.MD");
  });

  it("throws rather than silently escaping the vault", () => {
    expect(() => normalizeChatExportPath("")).toThrow(/cannot be empty/);
    expect(() => normalizeChatExportPath("../out.md")).toThrow(/inside the vault/);
    expect(() => normalizeChatExportPath("a/../../out.md")).toThrow(/inside the vault/);
  });
});

describe("normalizeVaultFolderPath", () => {
  it("trims leading and trailing separators", () => {
    expect(normalizeVaultFolderPath("/a/b/")).toBe("a/b");
    expect(normalizeVaultFolderPath("./a//b")).toBe("a/b");
  });
});

describe("slugifyFileName", () => {
  it("produces a safe slug and falls back when empty", () => {
    expect(slugifyFileName("Hello, World! 2026")).toBe("hello-world-2026");
    expect(slugifyFileName("***")).toBe("chat");
  });

  it("caps the length", () => {
    expect(slugifyFileName("a".repeat(200)).length).toBeLessThanOrEqual(72);
  });
});
