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
- Settings for Pi executable, Pi timeout, Ollama host, safe commands, web fetch, and allowed external read roots.

### Known Limitations

- Alpha release intended for private or trusted beta testing.
- Not all Ollama models support tools.
- Local models may hallucinate without explicit context.
- PDF extraction is best-effort and does not include OCR.
- Web fetch is disabled by default and intentionally limited.
- Reviewed edits currently target Markdown files.
- Automated end-to-end tests are not yet included.
