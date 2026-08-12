import path from "path";
import type { TFile } from "obsidian";

import type { MentionedVaultFileReference } from "../types";
import { stripVaultFileExtension } from "../util/vaultPath";
import { isKnownPromptToolDirective } from "./directives";

interface Range {
  end: number;
  start: number;
}

/**
 * Resolves `@path/to/note.md` and `@[[Wiki Link]]` mentions against the vault.
 * Longer candidates are matched first so `@a/b.md` wins over `@a`.
 */
export function extractMentionedVaultFileReferences(
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

/** `@`-mentions that matched no vault file and are not tool directives. */
export function extractUnresolvedMentionedVaultPaths(
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

export function normalizeMentionedPath(value: string): string {
  return value
    .replace(/[),.;:!?]+$/, "")
    .replace(/^\/+/, "")
    .trim();
}

export function resolveWikiLinkFile(
  value: string,
  files: TFile[]
): TFile | undefined {
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

export function getMentionedPathCandidates(mentionedPath: string): string[] {
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

export function isMentionBoundary(
  prompt: string,
  start: number,
  end: number
): boolean {
  const before = prompt[start - 1];
  const after = prompt[end];
  const validBefore = before === undefined || /\s|[([{]/.test(before);
  const validAfter = after === undefined || /\s|[),.;:!?}\]]/.test(after);

  return validBefore && validAfter;
}

export function rangesOverlap(left: Range, right: Range): boolean {
  return left.start < right.end && right.start < left.end;
}

/** Lower is a better match. POSITIVE_INFINITY means "do not suggest". */
export function scoreVaultFileSuggestion(
  filePath: string,
  query: string
): number {
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

export function isFuzzyMatch(value: string, query: string): boolean {
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
