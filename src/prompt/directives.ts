import type { PromptToolDirective } from "../types";

const DIRECTIVE_CALL_PATTERN = /@(search|semantic|url|cmd|links)\(([^)]{1,600})\)/gi;

export function extractPromptToolDirectives(
  prompt: string
): PromptToolDirective[] {
  const directives: PromptToolDirective[] = [];
  for (const match of prompt.matchAll(DIRECTIVE_CALL_PATTERN)) {
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

/**
 * Distinguishes a directive such as `@search(foo)` from an unresolved
 * `@some/file.md` mention, so the latter can be reported as a missing file.
 */
export function isKnownPromptToolDirective(value: string): boolean {
  return (
    /^(search|semantic|url|cmd|links)\(/i.test(value) ||
    /^(vault-index|links)$/i.test(value)
  );
}
