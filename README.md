# Agent Dashboard

Agent Dashboard is an alpha Obsidian plugin that adds a local-first agent chat sidebar for working beside your notes. It is designed around local Ollama models through Pi, with vault-aware context, conservative file linking, reviewed edits, and explicit safety boundaries.

This project is not trying to turn Obsidian into a full IDE. The goal is a focused companion panel for reading, reasoning over, and carefully editing notes while the normal Obsidian editor, graph, backlinks, and terminal plugins stay available.

## Status

Current release target: `0.1.0-alpha`.

The plugin is suitable for private alpha or trusted beta testing. It is not yet recommended for broad public use without reading the safety notes below and testing it in a copied vault first.

## Features

- Right sidebar agent dashboard for Obsidian desktop.
- Local model workflow through Pi and Ollama.
- Persistent chat sessions with a history landing page.
- Compact model rail with discovered Pi/Ollama models and capability badges.
- Markdown and math rendering through Obsidian's renderer.
- Vault file mentions with `@`, including Markdown, text-like files, attachments, and best-effort PDF text extraction.
- Prompt context helpers:
  - `@search(query)` for local vault search.
  - `@semantic(query)` for lightweight related-note search.
  - `@vault-index` for filenames and top headings.
  - `@links` or `@links(query)` for conservative internal link suggestions.
  - `@cmd(command)` for exact allowlisted local commands.
  - `@url(url)` for optional public web fetch context.
- Reviewed Markdown edit proposals with visible diffs and approval before write.
- Chat export to Markdown, defaulting to a `Chats/` folder in the vault.
- Obsidian command palette actions for opening the dashboard, exporting chats, checking Pi/Ollama, and suggesting internal links.

## Requirements

- Obsidian desktop `1.5.0` or newer.
- Node.js and npm for building from source.
- Ollama running locally.
- Pi installed and available as `pi`, or configured with an absolute executable path in plugin settings.
- At least one Ollama model configured in Pi.

Tool use depends on the selected model. Some Ollama models can chat but do not support tools. When a model does not support tools, keep Pi tools disabled and use explicit `@` context, `@search`, `@semantic`, and `@vault-index` instead.

## Installation From Source

1. Clone this repository.
2. Install dependencies:

```bash
npm install
```

3. Build the plugin:

```bash
npm run build
```

4. Create this folder in your vault:

```text
.obsidian/plugins/agent-dashboard/
```

5. Copy these files into that folder:

```text
main.js
manifest.json
styles.css
```

6. Reload Obsidian and enable `Agent Dashboard` in `Settings -> Community plugins`.

For alpha testing, use a copied vault or a small test vault first.

## Pi And Ollama Setup

1. Start Ollama.
2. Pull the local models you want to use.
3. Configure Pi so it can see those models.
4. In Obsidian, open `Settings -> Agent Dashboard`.
5. Confirm:
   - `Ollama host` points to your local Ollama server, usually `http://127.0.0.1:11434`.
   - `Pi executable` is either `pi` or the absolute path to your Pi binary.
   - `Pi tools` is `Disabled` until you intentionally enable read-only tools.
6. Open the dashboard and click `Ollama`, `Pi`, and `RPC` to confirm discovery.

The dashboard can still be useful without Pi tools. File mentions and local context directives are often safer and more reliable than asking a model to inspect the vault on its own.

## Usage

Open the command palette and run `Open agent dashboard`. The dashboard opens as a right sidebar so your main note stays visible.

Start a new chat from the session landing page, or select a previous session. Use the model rail at the top to switch models. Use `@` in the composer to attach vault files as context.

Useful prompt patterns:

```text
Summarize @Projects/Example/MAIN.md and list only facts supported by that file.
```

```text
Use @vault-index and @semantic(EGNO interpolation) to suggest related notes.
```

```text
Use @links for this note and propose only high-confidence Obsidian links.
```

```text
Use @cmd(git status) and tell me whether the vault plugin repo is clean.
```

When the agent proposes edits, it must use reviewed edit blocks. The plugin renders a diff and requires approval before applying changes.

## Safety Model

Agent Dashboard is built around conservative defaults.

- The default Pi tool mode is disabled.
- Read-only Pi tools, when enabled, are limited to `read`, `grep`, `find`, and `ls`.
- Pi `bash`, edit, and write tools are not enabled by the plugin.
- Shell execution is not generally available.
- `@cmd(...)` only runs exact commands listed in the safe command allowlist.
- Safe commands run without a shell and from the vault root.
- File writes require reviewed Markdown edit proposals and user approval.
- Deletes are blocked.
- Writes outside the vault are blocked.
- URL fetching is disabled by default.
- `@url(...)` blocks localhost and private network hosts.
- External workspace roots are opt-in and read-only.

These guardrails reduce risk, but they do not make local agent workflows risk-free. Local models can hallucinate, misunderstand paths, or propose incorrect edits. Review diffs before approving them.

## PDF Support

PDF mention support is best-effort. The plugin tries to extract text from common text-based PDFs inside the vault and adds that text as prompt context.

Limitations:

- No OCR.
- Scanned PDFs may produce no text.
- Encrypted or unusual PDFs may fail extraction.
- Very large PDFs are skipped.
- Extracted text is capped before it is sent to the model.

When PDF extraction fails, the plugin should tell the model that content was unavailable rather than letting it infer details from the filename.

## Internal Link Suggestions

The internal link tool is intentionally conservative. It builds candidates from Markdown filenames and top-level headings, ranks them with local related-note search, and proposes links only when meaningful visible terms appear in the current note.

Suggested links are rendered as reviewed diffs. They are not applied automatically.

## Known Limitations

- This is alpha software.
- Local models may hallucinate unless given exact context.
- Some Ollama models do not support tools.
- Pi behavior depends on the installed Pi version and local configuration.
- PDF extraction is not a full PDF parser and does not perform OCR.
- Web fetch is intentionally limited and disabled by default.
- The reviewed edit path currently targets Markdown files.
- There is no automated end-to-end test suite yet.
- Public release metadata still needs maintainer-specific details before a Community Plugin submission.

## Commands

The plugin registers these Obsidian commands:

- `Open agent dashboard`
- `Insert agent dashboard block`
- `Restart agent dashboard bridge`
- `Stop agent dashboard bridge`
- `Check Ollama status`
- `Check Pi executable`
- `Discover Pi RPC`
- `Stop agent run`
- `Clear agent events`
- `Start new persistent agent session`
- `Export active agent chat to Markdown`
- `Suggest internal links for current note`
- `Run agent safety self-check`
- `Create sample approval request`

## Development

Install dependencies:

```bash
npm install
```

Run typecheck:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Run the release readiness checks:

```bash
npm run release:check
```

Create a local release zip:

```bash
npm run release:zip
```

The release zip contains only:

- `main.js`
- `manifest.json`
- `styles.css`

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).

## Security

See [SECURITY.md](SECURITY.md) before enabling tools, safe commands, web fetch, or reviewed edits in an important vault.
