# Changelog

## 0.1.0

Initial alpha release candidate.

### Added

- Right-sidebar Local Sidekick view for Obsidian desktop.
- Local Pi and Ollama status checks.
- Pi RPC discovery and model selection.
- Persistent chat sessions with history view.
- Streaming chat display with Markdown and math rendering through Obsidian.
- Vault `@` file mentions for Markdown, text-like files, attachments, and PDFs.
- Best-effort PDF text extraction for text-based PDFs.
- Prompt context helpers for vault search, related-note search, vault index, safe commands, web fetch, and internal link suggestions.
- Reviewed Markdown edit proposals with diff rendering and approval queue.
- Chat export to Markdown in a vault `Chats/` folder.
- Conservative default safety mode with Pi tools disabled.
- Optional read-only Pi tools for `read`, `grep`, `find`, and `ls`.
- Settings for Pi executable, Pi timeout, Ollama host, safe commands, web fetch, allowed external read roots, and sidebar status panel height.
- Draggable vertical divider between Status and Agent panels, with persisted height, keyboard resizing, and double-click reset.
- Main-push release promotion workflow and dev-branch CI health workflow.
- Release packaging for `main.js`, `manifest.json`, `styles.css`, and the versioned release zip.

### Changed

- Replaced the large sidebar text title with the same `bot` icon used by the Obsidian ribbon action.
- Made the Status panel compact, scrollable, and user-resizable so the Agent view can take more vertical space.
- Moved model selection into a compact persistent model rail.
- Narrowed the default safe command allowlist to low-risk read-only commands: `git status` and `git diff --stat`.
- Pi prompt, discovery, and model-switch runs disable Pi extensions, skills, prompt templates, and context files by default unless the experimental setting is enabled.
- Updated public release documentation, release checklist, privacy notes, and security notes.

### Fixed

- Fixed recent chat history rows rendering as overlapping button boxes by resetting Obsidian button layout styles for session cards.
- Fixed `@` mention handling from the fresh session landing page.
- Fixed file mention path resolution for vault paths, wiki-style paths, and extensionless Markdown/PDF references.
- Improved model/tool error messaging when a selected Ollama model does not support Pi tools.
- Improved chat event rendering so status messages stream inline with model output instead of boxed cards.

### Security

- Web fetch now requires HTTPS and an explicit allowed-host list.
- Web fetch resolves DNS before request, blocks localhost/private/link-local/reserved/multicast/metadata-style addresses, and pins the HTTPS request to the checked DNS result.
- PDF text extraction now enforces stricter compressed stream, per-stream decoded, and total decoded byte limits.
- Non-default Pi executable paths require once-per-Obsidian-session confirmation before use.
- Experimental Pi extensions, skills, prompt templates, and context files require once-per-session confirmation before launch when enabled by vault settings.
- Documented that `.obsidian/plugins/local-sidekick/data.json` may contain prompts, replies, note excerpts, proposed edits, and settings, and may sync with vault configuration.

### Known Limitations

- Alpha release intended for private or trusted beta testing.
- Not all Ollama models support tools.
- Local models may hallucinate without explicit context.
- PDF extraction is best-effort and does not include OCR.
- Web fetch is disabled by default and intentionally limited.
- Reviewed edits currently target Markdown files.
- Automated end-to-end tests are not yet included.
