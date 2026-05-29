import { App, TFile } from "obsidian";

export type SidekickProfileToolMode = "disabled" | "read-only";

export interface SidekickProfile {
  description?: string;
  includePaths: string[];
  modelLabels: string[];
  name: string;
  path: string;
  prompt: string;
  toolMode?: SidekickProfileToolMode;
}

interface ParsedProfileFrontmatter {
  description?: string;
  include?: string[];
  model?: string;
  models?: string[];
  name?: string;
  tools?: string;
}

export const DEFAULT_SIDEKICK_ROOT = "Sidekick";
export const SIDEKICK_AGENTS_FOLDER = "Agents";
export const SIDEKICK_MEMORY_FOLDER = "Memory";

export function normalizeSidekickRoot(value: string | undefined): string {
  const normalized = normalizeVaultPath(value || DEFAULT_SIDEKICK_ROOT);
  return normalized || DEFAULT_SIDEKICK_ROOT;
}

export async function loadSidekickProfiles(
  app: App,
  rootFolder: string
): Promise<SidekickProfile[]> {
  const root = normalizeSidekickRoot(rootFolder);
  const agentPrefix = root + "/" + SIDEKICK_AGENTS_FOLDER + "/";
  const profiles: SidekickProfile[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (!file.path.startsWith(agentPrefix) || !file.path.endsWith(".agent.md")) {
      continue;
    }

    const contents = await app.vault.cachedRead(file);
    profiles.push(parseSidekickProfile(file, contents));
  }

  return profiles.sort((left, right) => left.name.localeCompare(right.name));
}

export function findSidekickProfile(
  profiles: SidekickProfile[],
  reference: string
): SidekickProfile | undefined {
  const normalizedReference = reference.trim().toLowerCase();
  if (!normalizedReference) {
    return undefined;
  }

  return profiles.find((profile) => {
    const basename = profile.path.split("/").pop()?.replace(/\.agent\.md$/i, "") ?? "";
    return [profile.name, profile.path, basename, profile.path.replace(/\.md$/i, "")]
      .map((value) => value.toLowerCase())
      .includes(normalizedReference);
  });
}

export function getSidekickProfileDisplayName(profile: SidekickProfile): string {
  return profile.name || profile.path.replace(/^.*\//, "").replace(/\.agent\.md$/i, "");
}

export function getSidekickProfileSlug(profile: SidekickProfile): string {
  return profile.path.replace(/^.*\//, "").replace(/\.agent\.md$/i, "");
}

export function getSidekickProfileModelLabels(profile: SidekickProfile): string[] {
  return profile.modelLabels;
}

export function getStarterSidekickFiles(rootFolder: string): Array<{ content: string; path: string }> {
  const root = normalizeSidekickRoot(rootFolder);
  return [
    {
      path: root + "/Agents/research-tutor.agent.md",
      content: agentFile({
        name: "research-tutor",
        description: "Socratic research helper for careful note-grounded explanations.",
        models: ["ollama/qwen3-coder:30b", "ollama/deepseek-r1:32b"],
        tools: "disabled",
        include: [
          root + "/Memory/vault-summary.md",
          root + "/Memory/user-preferences.md",
          root + "/Memory/glossary.md"
        ],
        body: [
          "You are a careful research tutor working inside an Obsidian vault.",
          "Use only supplied vault context as evidence for claims about the user's notes.",
          "Ask clarifying questions when the supplied context is insufficient.",
          "Prefer concise explanations, definitions, and concrete next reading steps."
        ].join("\n")
      })
    },
    {
      path: root + "/Agents/writing-editor.agent.md",
      content: agentFile({
        name: "writing-editor",
        description: "Local note editor for style, structure, and clarity.",
        models: ["ollama/gemma4:31b", "ollama/qwen3-coder:30b"],
        tools: "disabled",
        include: [
          root + "/Memory/user-preferences.md",
          root + "/Memory/glossary.md"
        ],
        body: [
          "You are an Obsidian writing editor.",
          "Preserve the user's meaning and voice.",
          "When proposing changes, use reviewed edit blocks so Local Sidekick can render diffs before applying them.",
          "Do not invent citations, files, or claims."
        ].join("\n")
      })
    },
    {
      path: root + "/Agents/code-reviewer.agent.md",
      content: agentFile({
        name: "code-reviewer",
        description: "Review code and technical notes with local, explicit context.",
        models: ["ollama/qwen3-coder:30b", "ollama/deepseek-r1:32b"],
        tools: "read-only",
        include: [
          root + "/Memory/project-index.md",
          root + "/Memory/user-preferences.md"
        ],
        body: [
          "You are a conservative code reviewer and technical note assistant.",
          "Prioritize bugs, correctness, safety, and missing tests.",
          "Use read-only tools only when enabled and only to inspect the vault/project.",
          "Report uncertainty explicitly."
        ].join("\n")
      })
    },
    {
      path: root + "/Agents/vault-linker.agent.md",
      content: agentFile({
        name: "vault-linker",
        description: "Suggest conservative Obsidian links between related notes.",
        models: ["ollama/qwen3-coder:30b", "ollama/gemma4:31b"],
        tools: "disabled",
        include: [
          root + "/Memory/project-index.md",
          root + "/Memory/glossary.md"
        ],
        body: [
          "You help maintain Obsidian internal links.",
          "Suggest links only for meaningful terms that clearly correspond to existing notes or top-level concepts.",
          "Do not link common words or weak matches.",
          "Prefer reviewed edit blocks for proposed link changes."
        ].join("\n")
      })
    },
    {
      path: root + "/Agents/glossary-curator.agent.md",
      content: agentFile({
        name: "glossary-curator",
        description: "Create and maintain a grounded glossary for the vault.",
        models: ["ollama/qwen3-coder:30b", "ollama/gemma4:31b"],
        tools: "disabled",
        include: [
          root + "/Memory/project-index.md",
          root + "/Memory/vault-summary.md",
          root + "/Memory/glossary.md"
        ],
        body: [
          "You curate a concise glossary for this Obsidian vault.",
          "Only add terms that are supported by supplied note context.",
          "For each term, include a short definition and source note path when available.",
          "Use reviewed edit blocks when proposing glossary updates."
        ].join("\n")
      })
    },
    {
      path: root + "/Prompts/summarize-note.prompt.md",
      content: [
        "# Summarize Note",
        "",
        "Summarize the supplied note using only the provided context.",
        "",
        "Include:",
        "",
        "- The central claim or purpose.",
        "- Key definitions and assumptions.",
        "- Open questions or unsupported claims.",
        "- Suggested related notes to inspect next, if context supports them."
      ].join("\n") + "\n"
    },
    {
      path: root + "/Prompts/research-questions.prompt.md",
      content: [
        "# Research Questions",
        "",
        "Generate careful research questions from the supplied note context.",
        "",
        "Keep each question grounded in the provided files and label any uncertainty."
      ].join("\n") + "\n"
    },
    {
      path: root + "/Prompts/glossary-update.prompt.md",
      content: [
        "# Glossary Update",
        "",
        "Suggest additions or refinements for Sidekick/Memory/glossary.md using only supplied note context.",
        "",
        "Prefer short definitions with source note paths. Use reviewed edit blocks for file changes."
      ].join("\n") + "\n"
    },
    {
      path: root + "/Memory/vault-summary.md",
      content: [
        "# Vault Summary",
        "",
        "Write a short, source-grounded overview of this vault here. Keep this file updated as your notes evolve.",
        "",
        "## Current Themes",
        "",
        "- ",
        "",
        "## Important Projects",
        "",
        "- "
      ].join("\n") + "\n"
    },
    {
      path: root + "/Memory/user-preferences.md",
      content: [
        "# User Preferences",
        "",
        "Use this file for durable local preferences you want Sidekick agents to remember.",
        "",
        "## Learning Preferences",
        "",
        "- ",
        "",
        "## Writing Preferences",
        "",
        "- ",
        "",
        "## Safety Preferences",
        "",
        "- Prefer explicit source paths when summarising vault content."
      ].join("\n") + "\n"
    },
    {
      path: root + "/Memory/project-index.md",
      content: [
        "# Project Index",
        "",
        "Run the Local Sidekick command to refresh this generated index from filenames and top headings.",
        "",
        "_Not generated yet._"
      ].join("\n") + "\n"
    },
    {
      path: root + "/Memory/glossary.md",
      content: [
        "# Glossary",
        "",
        "Maintain concise, source-grounded definitions here.",
        "",
        "| Term | Definition | Source notes |",
        "| --- | --- | --- |",
        "|  |  |  |"
      ].join("\n") + "\n"
    }
  ];
}

function parseSidekickProfile(file: TFile, contents: string): SidekickProfile {
  const { body, frontmatter } = splitFrontmatter(contents);
  const parsed = parseFrontmatter(frontmatter);
  const name = parsed.name?.trim() || file.basename.replace(/\.agent$/i, "");
  const modelLabels = uniqueStrings([
    ...(parsed.model ? [parsed.model] : []),
    ...(parsed.models ?? [])
  ].map(normalizeModelLabel).filter(Boolean));
  const includePaths = uniqueStrings((parsed.include ?? []).map(normalizeVaultPath).filter(Boolean));
  const toolMode = parsed.tools === "read-only" || parsed.tools === "disabled"
    ? parsed.tools
    : undefined;

  return {
    description: parsed.description?.trim() || undefined,
    includePaths,
    modelLabels,
    name,
    path: file.path,
    prompt: body.trim(),
    toolMode
  };
}

function splitFrontmatter(contents: string): { body: string; frontmatter: string } {
  const match = contents.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { body: contents, frontmatter: "" };
  }

  return {
    body: contents.slice(match[0].length),
    frontmatter: match[1]
  };
}

function parseFrontmatter(frontmatter: string): ParsedProfileFrontmatter {
  const result: ParsedProfileFrontmatter = {};
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = stripYamlQuotes(match[2].trim());
    if (key === "include" || key === "includes" || key === "models") {
      const items: string[] = [];
      if (value) {
        items.push(...parseInlineList(value));
      }
      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
        index += 1;
        items.push(stripYamlQuotes(lines[index].replace(/^\s+-\s+/, "").trim()));
      }
      if (key === "models") {
        result.models = items;
      } else {
        result.include = items;
      }
      continue;
    }

    if (key === "name") result.name = value;
    if (key === "description") result.description = value;
    if (key === "model") result.model = value;
    if (key === "tools") result.tools = value;
  }

  return result;
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripYamlQuotes(item.trim()))
      .filter(Boolean);
  }

  return [trimmed];
}

function stripYamlQuotes(value: string): string {
  return value.replace(/^['\"]|['\"]$/g, "");
}

function normalizeModelLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.includes("/") ? trimmed : "ollama/" + trimmed;
}

function normalizeVaultPath(value: string): string {
  return value
    .trim()
    .replace(/^['\"]|['\"]$/g, "")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function agentFile(options: {
  body: string;
  description: string;
  include: string[];
  models: string[];
  name: string;
  tools: SidekickProfileToolMode;
}): string {
  return [
    "---",
    "name: " + options.name,
    "description: " + options.description,
    "models:",
    ...options.models.map((model) => "  - " + model),
    "tools: " + options.tools,
    "include:",
    ...options.include.map((path) => "  - " + path),
    "---",
    "",
    options.body,
    ""
  ].join("\n");
}
