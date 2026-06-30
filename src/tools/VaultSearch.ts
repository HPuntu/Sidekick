import { App } from "obsidian";

export interface VaultSearchHit {
  headers: string[];
  matches: string[];
  path: string;
  score: number;
  tags: string[];
}

const MAX_QUERY_TOKENS = 12;
const MAX_SNIPPETS_PER_FILE = 3;
const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "because",
  "between",
  "for",
  "from",
  "how",
  "into",
  "not",
  "of",
  "the",
  "this",
  "that",
  "what",
  "when",
  "where",
  "with"
]);

export async function searchVault(
  app: App,
  query: string,
  limit = 10
): Promise<VaultSearchHit[]> {
  const normalizedQuery = query.trim();
  const tokens = tokenizeQuery(normalizedQuery);
  if (!normalizedQuery || tokens.length === 0) {
    return [];
  }

  const hits: VaultSearchHit[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const contents = await app.vault.cachedRead(file);
    const cache = app.metadataCache.getFileCache(file);
    const headers = (cache?.headings ?? []).map((heading) => heading.heading);
    const tags = [
      ...(cache?.tags ?? []).map((tag) => tag.tag),
      ...extractFrontmatterTags(cache?.frontmatter)
    ];
    const haystack = [
      file.path,
      file.basename,
      ...headers,
      ...tags,
      contents
    ].join("\n").toLowerCase();
    const score = scoreText(haystack, file.path, headers, tags, tokens);
    if (score <= 0) {
      continue;
    }

    hits.push({
      headers: headers.slice(0, 8),
      matches: extractSnippets(contents, tokens),
      path: file.path,
      score,
      tags: Array.from(new Set(tags)).slice(0, 8)
    });
  }

  return hits
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export async function findRelatedVaultNotes(
  app: App,
  query: string,
  limit = 8
): Promise<VaultSearchHit[]> {
  const queryTokens = tokenizeQuery(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const hits: VaultSearchHit[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const contents = await app.vault.cachedRead(file);
    const cache = app.metadataCache.getFileCache(file);
    const headers = (cache?.headings ?? []).map((heading) => heading.heading);
    const tags = [
      ...(cache?.tags ?? []).map((tag) => tag.tag),
      ...extractFrontmatterTags(cache?.frontmatter)
    ];
    const documentTokens = new Set(
      tokenizeQuery([file.basename, ...headers, ...tags, contents].join(" "))
    );
    let score = 0;
    for (const token of queryTokens) {
      if (documentTokens.has(token)) {
        score += token.length > 6 ? 2 : 1;
      }
    }

    if (score <= 0) {
      continue;
    }

    hits.push({
      headers: headers.slice(0, 8),
      matches: extractSnippets(contents, queryTokens),
      path: file.path,
      score,
      tags: Array.from(new Set(tags)).slice(0, 8)
    });
  }

  return hits
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export async function buildVaultIndexSummary(
  app: App,
  limit = 120
): Promise<string> {
  const files = app.vault.getMarkdownFiles().slice(0, limit);
  const lines = [`Vault Markdown files indexed: ${app.vault.getMarkdownFiles().length}`];

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const headers = (cache?.headings ?? [])
      .filter((heading) => heading.level <= 2)
      .map((heading) => heading.heading)
      .slice(0, 5);
    lines.push(`- ${file.path}${headers.length > 0 ? ` | ${headers.join(" · ")}` : ""}`);
  }

  if (app.vault.getMarkdownFiles().length > limit) {
    lines.push(`- ... ${app.vault.getMarkdownFiles().length - limit} more file(s) omitted`);
  }

  return lines.join("\n");
}

export function formatVaultSearchHits(
  label: string,
  query: string,
  hits: VaultSearchHit[]
): string {
  if (hits.length === 0) {
    return `${label}: no vault matches for "${query}".`;
  }

  return [
    `${label} for "${query}":`,
    ...hits.map((hit, index) =>
      [
        `${index + 1}. ${hit.path} (score ${hit.score})`,
        hit.headers.length > 0 ? `   headings: ${hit.headers.join(" · ")}` : "",
        hit.tags.length > 0 ? `   tags: ${hit.tags.join(", ")}` : "",
        ...hit.matches.map((match) => `   match: ${match}`)
      ].filter(Boolean).join("\n")
    )
  ].join("\n");
}

function tokenizeQuery(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9_-]{2,}/g)
        ?.filter((token) => !STOP_WORDS.has(token))
        .slice(0, MAX_QUERY_TOKENS) ?? []
    )
  );
}

function scoreText(
  haystack: string,
  filePath: string,
  headers: string[],
  tags: string[],
  tokens: string[]
): number {
  let score = 0;
  const pathText = filePath.toLowerCase();
  const headerText = headers.join(" ").toLowerCase();
  const tagText = tags.join(" ").toLowerCase();

  for (const token of tokens) {
    if (pathText.includes(token)) {
      score += 8;
    }
    if (headerText.includes(token)) {
      score += 5;
    }
    if (tagText.includes(token)) {
      score += 4;
    }
    if (haystack.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function extractSnippets(contents: string, tokens: string[]): string[] {
  const snippets: string[] = [];
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lowerLine = line.toLowerCase();
    if (!tokens.some((token) => lowerLine.includes(token))) {
      continue;
    }

    snippets.push(`L${index + 1}: ${line.trim().slice(0, 220)}`);
    if (snippets.length >= MAX_SNIPPETS_PER_FILE) {
      break;
    }
  }

  return snippets;
}

function extractFrontmatterTags(frontmatter: unknown): string[] {
  if (!frontmatter || typeof frontmatter !== "object") {
    return [];
  }

  const tags = (frontmatter as Record<string, unknown>).tags;
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === "string");
  }

  if (typeof tags === "string") {
    return tags.split(/[,\s]+/).filter(Boolean);
  }

  return [];
}
