import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";

import {
  extractMentionedVaultFileReferences,
  extractUnresolvedMentionedVaultPaths,
  isFuzzyMatch,
  normalizeMentionedPath,
  resolveWikiLinkFile,
  scoreVaultFileSuggestion
} from "../src/prompt/mentions";
import { extractPromptToolDirectives, isKnownPromptToolDirective } from "../src/prompt/directives";

/** Only `path` is read by the mention code. */
function file(filePath: string): TFile {
  return { path: filePath } as TFile;
}

const files = [
  file("Notes/Protein Folding.md"),
  file("Notes/Protein.md"),
  file("Papers/alphafold.pdf"),
  file("index.md")
];

describe("extractMentionedVaultFileReferences", () => {
  it("resolves a plain path mention", () => {
    const refs = extractMentionedVaultFileReferences("see @index.md please", files);
    expect(refs.map((r) => r.file.path)).toEqual(["index.md"]);
  });

  it("prefers the longest matching candidate", () => {
    const refs = extractMentionedVaultFileReferences(
      "see @Notes/Protein Folding.md",
      files
    );
    expect(refs.map((r) => r.file.path)).toEqual(["Notes/Protein Folding.md"]);
  });

  it("resolves an extensionless mention", () => {
    const refs = extractMentionedVaultFileReferences("see @index", files);
    expect(refs.map((r) => r.file.path)).toEqual(["index.md"]);
  });

  it("resolves wiki-link mentions", () => {
    const refs = extractMentionedVaultFileReferences("see @[[Protein]]", files);
    expect(refs.map((r) => r.file.path)).toEqual(["Notes/Protein.md"]);
  });

  it("requires a word boundary before the mention", () => {
    expect(extractMentionedVaultFileReferences("mail@index.md", files)).toEqual([]);
  });

  it("returns each file at most once", () => {
    const refs = extractMentionedVaultFileReferences("@index.md and @index.md", files);
    expect(refs).toHaveLength(1);
  });

  it("orders results by position in the prompt", () => {
    const refs = extractMentionedVaultFileReferences(
      "@Papers/alphafold.pdf then @index.md",
      files
    );
    expect(refs.map((r) => r.file.path)).toEqual([
      "Papers/alphafold.pdf",
      "index.md"
    ]);
  });
});

describe("extractUnresolvedMentionedVaultPaths", () => {
  it("reports mentions that matched no file", () => {
    const resolved = extractMentionedVaultFileReferences("@index.md @nope.md", files);
    expect(extractUnresolvedMentionedVaultPaths("@index.md @nope.md", resolved)).toEqual(
      ["nope.md"]
    );
  });

  it("does not report tool directives as unresolved files", () => {
    const prompt = "@search(folding) @vault-index @links";
    const resolved = extractMentionedVaultFileReferences(prompt, files);
    expect(extractUnresolvedMentionedVaultPaths(prompt, resolved)).toEqual([]);
  });

  it("strips trailing punctuation", () => {
    expect(extractUnresolvedMentionedVaultPaths("see @nope.md, then", [])).toEqual([
      "nope.md"
    ]);
  });
});

describe("normalizeMentionedPath", () => {
  it("removes trailing punctuation and leading slashes", () => {
    expect(normalizeMentionedPath("/a/b.md,")).toBe("a/b.md");
  });
});

describe("resolveWikiLinkFile", () => {
  it("ignores alias and heading fragments", () => {
    expect(resolveWikiLinkFile("Protein|alias", files)?.path).toBe("Notes/Protein.md");
    expect(resolveWikiLinkFile("Protein#Section", files)?.path).toBe("Notes/Protein.md");
  });

  it("returns undefined for an empty or unknown target", () => {
    expect(resolveWikiLinkFile("  ", files)).toBeUndefined();
    expect(resolveWikiLinkFile("Missing", files)).toBeUndefined();
  });
});

describe("scoreVaultFileSuggestion", () => {
  it("ranks exact, prefix, basename, substring, then fuzzy", () => {
    expect(scoreVaultFileSuggestion("notes/a.md", "notes/a.md")).toBe(0);
    expect(scoreVaultFileSuggestion("notes/a.md", "notes/")).toBe(1);
    expect(scoreVaultFileSuggestion("notes/abc.md", "abc")).toBe(2);
    expect(scoreVaultFileSuggestion("notes/xabc.md", "abc")).toBe(3);
    expect(scoreVaultFileSuggestion("notes/a-b-c.md", "abc")).toBe(4);
  });

  it("excludes non-matches", () => {
    expect(scoreVaultFileSuggestion("notes/a.md", "zzz")).toBe(
      Number.POSITIVE_INFINITY
    );
  });
});

describe("isFuzzyMatch", () => {
  it("matches characters in order, not necessarily adjacent", () => {
    expect(isFuzzyMatch("protein folding", "pfold")).toBe(true);
    expect(isFuzzyMatch("protein folding", "zx")).toBe(false);
  });
});

describe("extractPromptToolDirectives", () => {
  it("extracts call-style directives with their arguments", () => {
    expect(extractPromptToolDirectives("@search(folding) @url(https://a.test)")).toEqual([
      { kind: "search", value: "folding" },
      { kind: "url", value: "https://a.test" }
    ]);
  });

  it("extracts bare directives", () => {
    expect(extractPromptToolDirectives("do it @vault-index")).toEqual([
      { kind: "index", value: "" }
    ]);
  });

  it("finds nothing in a plain prompt", () => {
    expect(extractPromptToolDirectives("just a question")).toEqual([]);
  });
});

describe("isKnownPromptToolDirective", () => {
  it("recognises directive forms and rejects file paths", () => {
    expect(isKnownPromptToolDirective("search(x)")).toBe(true);
    expect(isKnownPromptToolDirective("vault-index")).toBe(true);
    expect(isKnownPromptToolDirective("notes/a.md")).toBe(false);
  });
});
