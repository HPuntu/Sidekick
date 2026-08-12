import path from "path";

export function getVaultFolderPath(vaultPath: string): string {
  const folderPath = path.posix.dirname(vaultPath);
  return folderPath === "." ? "" : folderPath;
}

export function formatVaultFolderLabel(folderPath: string): string {
  return folderPath || "/";
}

export function stripVaultFileExtension(vaultPath: string): string {
  const extension = path.extname(vaultPath);
  return extension ? vaultPath.slice(0, -extension.length) : vaultPath;
}

export function normalizeVaultFolderPath(value: string): string {
  return path.posix
    .normalize(value.replace(/^\/+/, ""))
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

/** Returns "" for anything that escapes the vault root. */
export function normalizeProposedEditPath(value: string): string {
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

/** Throws rather than returning "" so the export UI can surface the reason. */
export function normalizeChatExportPath(value: string): string {
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

export function slugifyFileName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 72);

  return slug || "chat";
}
