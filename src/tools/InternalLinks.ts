import { App, TFile } from "obsidian";

import { findRelatedVaultNotes } from "./VaultSearch";

export interface InternalLinkProposal {
  originalText: string;
  replacementText: string;
  suggestions: InternalLinkSuggestion[];
}

export interface InternalLinkSuggestion {
  display: string;
  target: string;
  term: string;
}

interface LinkTarget {
  heading?: string;
  path: string;
  relatedScore: number;
  term: string;
}

const MAX_LINK_SUGGESTIONS = 18;
const STOP_TERMS = new Set([
  "abstract",
  "appendix",
  "background",
  "conclusion",
  "design",
  "discussion",
  "introduction",
  "main",
  "method",
  "methods",
  "note",
  "notes",
  "overview",
  "project",
  "results",
  "summary",
  "the"
]);

export async function proposeInternalLinksForFile(
  app: App,
  sourceFile: TFile
): Promise<InternalLinkProposal> {
  const originalText = await app.vault.cachedRead(sourceFile);
  const targets = await buildLinkTargets(app, sourceFile);
  const protectedRanges = getProtectedRanges(originalText);
  const usedTargets = getExistingWikiTargets(originalText);
  const suggestions: InternalLinkSuggestion[] = [];
  const replacements: Array<{ end: number; start: number; text: string }> = [];

  for (const target of targets) {
    if (suggestions.length >= MAX_LINK_SUGGESTIONS) {
      break;
    }

    const linkTarget = formatLinkTarget(target);
    if (usedTargets.has(stripHeading(linkTarget))) {
      continue;
    }

    const match = findEligibleTermMatch(originalText, target.term, protectedRanges);
    if (!match) {
      continue;
    }

    const display = originalText.slice(match.start, match.end);
    suggestions.push({
      display,
      target: linkTarget,
      term: target.term
    });
    replacements.push({
      end: match.end,
      start: match.start,
      text: `[[${linkTarget}|${display}]]`
    });
    protectedRanges.push({ end: match.end, start: match.start });
  }

  const replacementText = applyReplacements(originalText, replacements);
  return {
    originalText,
    replacementText,
    suggestions
  };
}

export function formatInternalLinkSuggestions(
  sourcePath: string,
  suggestions: InternalLinkSuggestion[]
): string {
  if (suggestions.length === 0) {
    return `No conservative internal link suggestions found for ${sourcePath}.`;
  }

  return [
    `Suggested internal links for ${sourcePath}:`,
    ...suggestions.map(
      (suggestion) =>
        `- "${suggestion.display}" -> [[${suggestion.target}|${suggestion.display}]]`
    )
  ].join("\n");
}

async function buildLinkTargets(app: App, sourceFile: TFile): Promise<LinkTarget[]> {
  const targets: LinkTarget[] = [];
  const sourceText = await app.vault.cachedRead(sourceFile);
  const relatedScores = await getRelatedNoteScores(app, sourceFile, sourceText);
  for (const file of app.vault.getMarkdownFiles()) {
    if (file.path === sourceFile.path) {
      continue;
    }

    const relatedScore = relatedScores.get(file.path) ?? 0;
    addTermTargets(targets, file.path, file.basename, undefined, relatedScore);
    const contents = await app.vault.cachedRead(file);
    for (const heading of getTopHeadings(contents)) {
      addTermTargets(targets, file.path, heading, heading, relatedScore);
    }
  }

  const seen = new Set<string>();
  return targets
    .filter((target) => isMeaningfulTerm(target.term))
    .sort(
      (left, right) =>
        right.relatedScore - left.relatedScore ||
        right.term.length - left.term.length ||
        left.path.localeCompare(right.path)
    )
    .filter((target) => {
      const key = `${target.path}#${target.heading ?? ""}:${target.term.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function addTermTargets(
  targets: LinkTarget[],
  path: string,
  phrase: string,
  heading: string | undefined,
  relatedScore: number
): void {
  const terms = createMeaningfulTerms(phrase);
  for (const term of terms) {
    targets.push({ heading, path, relatedScore, term });
  }
}

async function getRelatedNoteScores(
  app: App,
  sourceFile: TFile,
  sourceText: string
): Promise<Map<string, number>> {
  const query = buildRelatedQuery(sourceFile, sourceText);
  const hits = await findRelatedVaultNotes(app, query, 48);
  const scores = new Map<string, number>();
  for (const hit of hits) {
    if (hit.path !== sourceFile.path) {
      scores.set(hit.path, hit.score);
    }
  }

  return scores;
}

function buildRelatedQuery(sourceFile: TFile, sourceText: string): string {
  const headings = getTopHeadings(sourceText);
  return [
    sourceFile.basename,
    ...headings,
    extractDenseTextPrefix(sourceText)
  ].join(" ");
}

function extractDenseTextPrefix(value: string): string {
  return value
    .replace(/^---[\s\S]*?^---/m, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[[^\]]+\]\]/g, " ")
    .replace(/[#>*_[\]()`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);
}

function createMeaningfulTerms(phrase: string): string[] {
  const cleaned = phrase.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const tokens = cleaned.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? [];
  const terms = new Set<string>();

  if (isMeaningfulTerm(cleaned)) {
    terms.add(cleaned);
  }

  for (const token of tokens) {
    if (/^[A-Z0-9]{3,}$/.test(token)) {
      terms.add(token);
    }
  }

  for (let size = 2; size <= Math.min(5, tokens.length); size += 1) {
    for (let start = 0; start <= tokens.length - size; start += 1) {
      const term = tokens.slice(start, start + size).join(" ");
      if (isMeaningfulTerm(term)) {
        terms.add(term);
      }
    }
  }

  return Array.from(terms);
}

function getTopHeadings(contents: string): string[] {
  const headings = [...contents.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    text: match[2].replace(/#+$/, "").trim()
  }));
  const topLevel = Math.min(...headings.map((heading) => heading.level));
  if (!Number.isFinite(topLevel)) {
    return [];
  }

  return headings
    .filter((heading) => heading.level === topLevel)
    .map((heading) => heading.text)
    .slice(0, 8);
}

function isMeaningfulTerm(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (STOP_TERMS.has(lower)) {
    return false;
  }

  const tokens = normalized.match(/[A-Za-z0-9][A-Za-z0-9-]*/g) ?? [];
  if (tokens.length >= 2) {
    return tokens.some((token) => !STOP_TERMS.has(token.toLowerCase()) && token.length >= 4);
  }

  const token = tokens[0] ?? "";
  return /^[A-Z0-9]{3,}$/.test(token) || token.length >= 6;
}

function findEligibleTermMatch(
  text: string,
  term: string,
  protectedRanges: Array<{ end: number; start: number }>
): { end: number; start: number } | undefined {
  const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }

    const start = match.index;
    const end = start + match[0].length;
    if (!isInsideProtectedRange(start, end, protectedRanges)) {
      return { end, start };
    }
  }

  return undefined;
}

function getProtectedRanges(text: string): Array<{ end: number; start: number }> {
  return [
    ...getRegexRanges(text, /^```[\s\S]*?^```/gm),
    ...getRegexRanges(text, /`[^`\n]+`/g),
    ...getRegexRanges(text, /\[\[[\s\S]*?\]\]/g),
    ...getRegexRanges(text, /\[[^\]]+\]\([^)]+\)/g),
    ...getRegexRanges(text, /^---[\s\S]*?^---/m)
  ];
}

function getRegexRanges(
  text: string,
  pattern: RegExp
): Array<{ end: number; start: number }> {
  return [...text.matchAll(pattern)]
    .filter((match) => match.index !== undefined)
    .map((match) => ({
      end: match.index! + match[0].length,
      start: match.index!
    }));
}

function getExistingWikiTargets(text: string): Set<string> {
  const targets = new Set<string>();
  for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
    targets.add(match[1].trim());
  }

  return targets;
}

function isInsideProtectedRange(
  start: number,
  end: number,
  ranges: Array<{ end: number; start: number }>
): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function formatLinkTarget(target: LinkTarget): string {
  const basePath = target.path.replace(/\.md$/i, "");
  if (!target.heading) {
    return basePath;
  }

  return `${basePath}#${target.heading}`;
}

function stripHeading(target: string): string {
  return target.split("#")[0];
}

function applyReplacements(
  text: string,
  replacements: Array<{ end: number; start: number; text: string }>
): string {
  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, replacement) =>
        `${current.slice(0, replacement.start)}${replacement.text}${current.slice(replacement.end)}`,
      text
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
