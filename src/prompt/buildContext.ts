import { App, MarkdownFileInfo, Notice, TFile } from "obsidian";

import type { SidekickProfile } from "../agent/SidekickProfile";
import { getSidekickProfileDisplayName } from "../agent/SidekickProfile";
import { describePiToolMode } from "../bridge/pi/piFlags";
import type { SafetyDecision, SafetyRequest } from "../security/SafetyPolicy";
import type { AgentDashboardSettings } from "../settings";
import {
  formatInternalLinkSuggestions,
  proposeInternalLinksForFile
} from "../tools/InternalLinks";
import { extractPdfText } from "../tools/PdfText";
import { parseAllowedCommands, runAllowedCommand } from "../tools/SafeCommands";
import {
  buildVaultIndexSummary,
  findRelatedVaultNotes,
  formatVaultSearchHits,
  searchVault
} from "../tools/VaultSearch";
import { fetchUrlText, parseAllowedHosts } from "../tools/WebFetch";
import type { AgentPromptContextMode, PromptContextBlock } from "../types";
import { getErrorMessage, truncatePlainText } from "../util/text";
import { formatVaultFolderLabel, getVaultFolderPath } from "../util/vaultPath";
import { extractPromptToolDirectives } from "./directives";
import {
  extractMentionedVaultFileReferences,
  extractUnresolvedMentionedVaultPaths,
  normalizeMentionedPath
} from "./mentions";
import {
  canReadMentionedFileAsText,
  formatMentionedAttachmentContext,
  formatPromptContext,
  formatVaultDirectoryContext,
  limitContextText,
  MAX_CONTEXT_CHARS,
  MAX_MENTIONED_FILES,
  MAX_PDF_CONTEXT_BYTES,
  MAX_SIDEKICK_PROFILE_INCLUDES
} from "./promptContext";

/**
 * Everything the context builders need from the plugin. Built once per prompt
 * so the settings and active-file values stay consistent across one run.
 *
 * A builder returning `undefined` means "abort this prompt"; it has already
 * explained why via `reportBlocked`.
 */
export interface PromptContextDeps {
  activeMarkdownFile: MarkdownFileInfo | null;
  app: App;
  assess(request: SafetyRequest): SafetyDecision;
  /** Logs a tool event without repainting; the run continues. */
  report(text: string): void;
  /** Logs a tool event and repaints, for paths that abort the prompt. */
  reportBlocked(text: string): void;
  settings: AgentDashboardSettings;
  /** Vault-relative path to an on-disk path, for the safety policy. */
  toAbsolutePath(vaultPath: string): string;
  vaultRoot: string | undefined;
}

export async function buildSidekickProfileContext(
  deps: PromptContextDeps,
  profile: SidekickProfile | undefined
): Promise<PromptContextBlock[] | undefined> {
  if (!profile) {
    return [];
  }

  if (profile.includePaths.length > MAX_SIDEKICK_PROFILE_INCLUDES) {
    new Notice(
      `Sidekick profile includes too many files. Limit is ${MAX_SIDEKICK_PROFILE_INCLUDES}.`
    );
    return undefined;
  }

  const profileLines = [
    `Name: ${profile.name}`,
    `Path: ${profile.path}`,
    profile.description ? `Description: ${profile.description}` : "",
    profile.modelLabels.length > 0
      ? `Model choices: ${profile.modelLabels.join(", ")}`
      : "",
    profile.toolMode
      ? `Requested Pi tools: ${describePiToolMode(profile.toolMode)}`
      : "",
    "",
    "Instructions:",
    profile.prompt
  ].filter(Boolean);

  const blocks: PromptContextBlock[] = [
    {
      eventText: `Loaded Sidekick agent profile ${getSidekickProfileDisplayName(profile)}.`,
      promptPrefix: formatPromptContext(
        "Sidekick agent profile",
        profile.path,
        limitContextText(profileLines.join("\n"))
      )
    }
  ];

  for (const includePath of profile.includePaths) {
    const file = deps.app.vault.getFileByPath(includePath);
    if (!file) {
      new Notice(`Sidekick include not found: ${includePath}`);
      deps.reportBlocked(
        `Blocked Sidekick include: ${includePath} was not found in the vault.`
      );
      return undefined;
    }

    if (!canReadMentionedFileAsText(file)) {
      new Notice(`Sidekick include must be a text file: ${file.path}`);
      deps.reportBlocked(
        `Blocked Sidekick include: ${file.path} is not a readable text context file.`
      );
      return undefined;
    }

    const readDecision = deps.assess({
      description: `Read Sidekick profile include: ${file.path}`,
      kind: "read",
      targetPath: deps.toAbsolutePath(file.path)
    });

    if (!readDecision.allowed) {
      deps.reportBlocked(
        `Safety guard blocked Sidekick include ${file.path}: ${readDecision.reason}`
      );
      return undefined;
    }

    const contents = await deps.app.vault.cachedRead(file);
    const text = limitContextText(contents);
    blocks.push({
      eventText: `Loaded Sidekick memory include ${file.path} (${text.length.toLocaleString()} chars).`,
      promptPrefix: formatPromptContext("Sidekick memory include", file.path, text)
    });
  }

  return blocks;
}

/**
 * Files the user pinned to the session. Unlike @-mentions these are attached to
 * every prompt, so a missing or unreadable one is reported and skipped rather
 * than aborting the run.
 */
export async function buildPinnedContext(
  deps: PromptContextDeps,
  pinnedPaths: string[]
): Promise<PromptContextBlock[]> {
  const blocks: PromptContextBlock[] = [];

  for (const pinnedPath of pinnedPaths) {
    const file = deps.app.vault.getFileByPath(pinnedPath);
    if (!file) {
      deps.report(`Pinned note skipped: ${pinnedPath} is no longer in the vault.`);
      continue;
    }

    if (!canReadMentionedFileAsText(file)) {
      deps.report(`Pinned note skipped: ${file.path} is not a readable text file.`);
      continue;
    }

    const readDecision = deps.assess({
      description: `Read pinned note: ${file.path}`,
      kind: "read",
      targetPath: deps.toAbsolutePath(file.path)
    });

    if (!readDecision.allowed) {
      deps.report(`Pinned note skipped: ${file.path} - ${readDecision.reason}`);
      continue;
    }

    const text = limitContextText(await deps.app.vault.cachedRead(file));
    blocks.push({
      eventText: `Added pinned note ${file.path} (${text.length.toLocaleString()} chars).`,
      promptPrefix: formatPromptContext("Pinned note", file.path, text)
    });
  }

  return blocks;
}

export async function buildNoteContext(
  deps: PromptContextDeps,
  mode: Exclude<AgentPromptContextMode, "none">
): Promise<PromptContextBlock | undefined> {
  const activeInfo = deps.activeMarkdownFile;
  const file =
    mode === "selection"
      ? activeInfo?.file
      : deps.app.workspace.getActiveFile() ?? activeInfo?.file;

  if (!file) {
    new Notice("No active note found");
    return undefined;
  }

  const readDecision = deps.assess({
    description:
      mode === "note" ? "Read current note context" : "Read selection context",
    kind: "read",
    targetPath: deps.toAbsolutePath(file.path)
  });

  if (!readDecision.allowed) {
    deps.reportBlocked(`Safety guard blocked context: ${readDecision.reason}`);
    return undefined;
  }

  if (mode === "selection") {
    const selection = activeInfo?.editor?.getSelection().trim() ?? "";
    if (!selection) {
      new Notice("No active editor selection found");
      return undefined;
    }

    const text = limitContextText(selection);
    return {
      eventText: `Added selection context from ${file.path} (${text.length.toLocaleString()} chars).`,
      promptPrefix: formatPromptContext("Current selection", file.path, text)
    };
  }

  const contents = await deps.app.vault.read(file);
  const text = limitContextText(contents);
  return {
    eventText: `Added current note context from ${file.path} (${text.length.toLocaleString()} chars).`,
    promptPrefix: formatPromptContext("Current note", file.path, text)
  };
}

export async function buildMentionedFileContext(
  deps: PromptContextDeps,
  prompt: string
): Promise<PromptContextBlock[] | undefined> {
  const mentionedFiles = extractMentionedVaultFileReferences(
    prompt,
    deps.app.vault.getFiles()
  );
  const unresolvedMentions = extractUnresolvedMentionedVaultPaths(
    prompt,
    mentionedFiles
  );

  if (unresolvedMentions.length > 0) {
    const unresolvedMention = unresolvedMentions[0];
    new Notice(`Could not resolve @${unresolvedMention}`);
    deps.reportBlocked(
      `Blocked @ context: @${unresolvedMention} was not found in the vault.`
    );
    return undefined;
  }

  if (mentionedFiles.length === 0) {
    return [];
  }

  if (mentionedFiles.length > MAX_MENTIONED_FILES) {
    new Notice(`Too many @ files. Limit is ${MAX_MENTIONED_FILES} per prompt.`);
    return undefined;
  }

  const blocks: PromptContextBlock[] = [];
  for (const mentionedFile of mentionedFiles) {
    const file = mentionedFile.file;
    const readDecision = deps.assess({
      description: `Read @ file context: ${file.path}`,
      kind: "read",
      targetPath: deps.toAbsolutePath(file.path)
    });

    if (!readDecision.allowed) {
      deps.reportBlocked(
        `Safety guard blocked @${mentionedFile.mention}: ${readDecision.reason}`
      );
      return undefined;
    }

    if (file.extension.toLowerCase() === "pdf") {
      blocks.push(await buildMentionedPdfContext(deps, file));
    } else if (canReadMentionedFileAsText(file)) {
      const contents = await deps.app.vault.read(file);
      const text = limitContextText(contents);
      blocks.push({
        eventText: `Added @ context from ${file.path} (${text.length.toLocaleString()} chars).`,
        promptPrefix: formatPromptContext("Mentioned file", file.path, text)
      });
    } else {
      blocks.push({
        eventText: `Added @ attachment reference for ${file.path}.`,
        promptPrefix: formatPromptContext(
          "Mentioned attachment",
          file.path,
          formatMentionedAttachmentContext(file)
        )
      });
    }

    const directoryContext = buildMentionedFileDirectoryContext(deps, file);
    if (directoryContext) {
      blocks.push(directoryContext);
    }
  }

  return blocks;
}

function buildMentionedFileDirectoryContext(
  deps: PromptContextDeps,
  file: TFile
): PromptContextBlock | undefined {
  const folderPath = getVaultFolderPath(file.path);
  const readDecision = deps.assess({
    description: `List vault directory for @ file: ${formatVaultFolderLabel(folderPath)}`,
    kind: "read",
    targetPath: deps.toAbsolutePath(folderPath)
  });

  if (!readDecision.allowed) {
    deps.reportBlocked(
      `Safety guard blocked directory context for ${file.path}: ${readDecision.reason}`
    );
    return undefined;
  }

  return {
    eventText: `Added directory context for ${formatVaultFolderLabel(folderPath)}.`,
    promptPrefix: formatPromptContext(
      "Vault directory listing",
      formatVaultFolderLabel(folderPath),
      formatVaultDirectoryContext(file, deps.app.vault.getAllLoadedFiles())
    )
  };
}

/** Never aborts: an unreadable PDF degrades to an attachment reference. */
async function buildMentionedPdfContext(
  deps: PromptContextDeps,
  file: TFile
): Promise<PromptContextBlock> {
  if (file.stat.size > MAX_PDF_CONTEXT_BYTES) {
    return {
      eventText: `Added @ PDF reference for ${file.path}; extraction skipped because the file is too large.`,
      promptPrefix: formatPromptContext(
        "Mentioned PDF attachment",
        file.path,
        formatMentionedAttachmentContext(
          file,
          `PDF text extraction skipped because the file is larger than ${(MAX_PDF_CONTEXT_BYTES / 1024 / 1024).toLocaleString()} MB.`
        )
      )
    };
  }

  try {
    const data = await deps.app.vault.readBinary(file);
    const extracted = extractPdfText(data, MAX_CONTEXT_CHARS);
    if (!extracted.text) {
      return {
        eventText: `Added @ PDF reference for ${file.path}; no selectable text was extracted.`,
        promptPrefix: formatPromptContext(
          "Mentioned PDF attachment",
          file.path,
          formatMentionedAttachmentContext(file, extracted.warning)
        )
      };
    }

    return {
      eventText: `Extracted @ PDF text from ${file.path} (${extracted.text.length.toLocaleString()} chars).`,
      promptPrefix: formatPromptContext(
        "Mentioned PDF text",
        file.path,
        [
          `Path: ${file.path}`,
          `Extracted text blocks: ${extracted.pageLikeBlocks}`,
          extracted.warning ? `Warning: ${extracted.warning}` : "",
          "",
          extracted.text
        ].filter(Boolean).join("\n")
      )
    };
  } catch (error) {
    return {
      eventText: `Added @ PDF reference for ${file.path}; extraction failed.`,
      promptPrefix: formatPromptContext(
        "Mentioned PDF attachment",
        file.path,
        formatMentionedAttachmentContext(
          file,
          `PDF text extraction failed: ${getErrorMessage(error)}`
        )
      )
    };
  }
}

export async function buildVaultSearchContext(
  deps: PromptContextDeps,
  query: string
): Promise<PromptContextBlock[]> {
  const [exactHits, relatedHits, indexSummary] = await Promise.all([
    searchVault(deps.app, query, 8),
    findRelatedVaultNotes(deps.app, query, 8),
    buildVaultIndexSummary(deps.app, 80)
  ]);

  return [
    {
      eventText: `Added vault search context for "${truncatePlainText(query, 48)}".`,
      promptPrefix: formatPromptContext(
        "Vault search",
        "vault",
        [
          formatVaultSearchHits("Exact/metadata vault search", query, exactHits),
          "",
          formatVaultSearchHits("Related-note search", query, relatedHits),
          "",
          indexSummary
        ].join("\n")
      )
    }
  ];
}

export async function buildDirectiveContext(
  deps: PromptContextDeps,
  prompt: string
): Promise<PromptContextBlock[]> {
  const directives = extractPromptToolDirectives(prompt);
  if (directives.length === 0) {
    return [];
  }

  const blocks: PromptContextBlock[] = [];
  for (const directive of directives) {
    if (directive.kind === "search") {
      const hits = await searchVault(deps.app, directive.value, 10);
      blocks.push({
        eventText: `Ran vault search for "${directive.value}".`,
        promptPrefix: formatPromptContext(
          "Vault search",
          `@search(${directive.value})`,
          formatVaultSearchHits(
            "Exact/metadata vault search",
            directive.value,
            hits
          )
        )
      });
      continue;
    }

    if (directive.kind === "semantic") {
      const hits = await findRelatedVaultNotes(deps.app, directive.value, 10);
      blocks.push({
        eventText: `Ran related-note search for "${directive.value}".`,
        promptPrefix: formatPromptContext(
          "Related-note search",
          `@semantic(${directive.value})`,
          formatVaultSearchHits("Related-note search", directive.value, hits)
        )
      });
      continue;
    }

    if (directive.kind === "index") {
      blocks.push({
        eventText: "Added vault filename/header index.",
        promptPrefix: formatPromptContext(
          "Vault filename and heading index",
          "vault",
          await buildVaultIndexSummary(deps.app)
        )
      });
      continue;
    }

    if (directive.kind === "url") {
      if (!deps.settings.webFetchEnabled) {
        deps.report("Blocked URL fetch: web fetch is disabled.");
        continue;
      }

      const result = await fetchUrlText(
        directive.value,
        parseAllowedHosts(deps.settings.webFetchAllowedHosts)
      );
      blocks.push({
        eventText: result.error
          ? `URL fetch failed for ${directive.value}: ${result.error}`
          : `Fetched URL context from ${result.url}.`,
        promptPrefix: formatPromptContext(
          "Fetched URL",
          result.url,
          result.error
            ? `Fetch failed: ${result.error}`
            : [`Title: ${result.title ?? "unknown"}`, "", result.content].join("\n")
        )
      });
      continue;
    }

    if (directive.kind === "cmd") {
      blocks.push(await runCommandDirective(deps, directive.value));
      continue;
    }

    if (directive.kind === "links") {
      const file = directive.value
        ? deps.app.vault.getFileByPath(normalizeMentionedPath(directive.value))
        : deps.app.workspace.getActiveFile() ?? deps.activeMarkdownFile?.file;
      if (!file) {
        deps.report("Internal link suggestions skipped: note not found.");
        continue;
      }

      const proposal = await proposeInternalLinksForFile(deps.app, file);
      blocks.push({
        eventText: `Added internal link suggestions for ${file.path}.`,
        promptPrefix: formatPromptContext(
          "Internal link suggestions",
          file.path,
          formatInternalLinkSuggestions(file.path, proposal.suggestions)
        )
      });
    }
  }

  return blocks;
}

async function runCommandDirective(
  deps: PromptContextDeps,
  command: string
): Promise<PromptContextBlock> {
  const allowedCommands = parseAllowedCommands(deps.settings.safeCommandAllowlist);
  const commandAllowed = allowedCommands.includes(
    command.trim().replace(/\s+/g, " ")
  );
  const decision = deps.assess({
    command,
    description: `Run safe command: ${command}`,
    kind: commandAllowed ? "safe-command" : "shell"
  });

  if (!decision.allowed) {
    return {
      eventText: `Blocked command context: ${decision.reason}`,
      promptPrefix: formatPromptContext(
        "Safe command output",
        command,
        `Command blocked: ${decision.reason}`
      )
    };
  }

  const result = await runAllowedCommand(command, allowedCommands, deps.vaultRoot);
  return {
    eventText: result.success
      ? `Ran safe command: ${result.command}`
      : `Safe command blocked or failed: ${result.command}`,
    promptPrefix: formatPromptContext(
      "Safe command output",
      result.command,
      [
        `Command: ${result.command}`,
        `Success: ${result.success}`,
        result.exitCode === undefined ? "" : `Exit code: ${result.exitCode}`,
        "",
        result.output
      ].filter(Boolean).join("\n")
    )
  };
}
