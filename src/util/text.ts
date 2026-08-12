export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function asPlainRecord(
  value: unknown
): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** YAML frontmatter scalars are emitted as JSON strings, which YAML accepts. */
export function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

export function sanitizeProjectIndexText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncatePlainText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 3, 0))}...`;
}

export function getMaxIdCounter(
  records: { id: string }[],
  prefix: string
): number {
  return records.reduce((max, record) => {
    if (!record.id.startsWith(prefix)) {
      return max;
    }

    const value = Number(record.id.slice(prefix.length));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
}
