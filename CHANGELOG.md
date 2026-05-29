## 0.1.6 - 2026-05-27

- Reduce runtime filesystem access warning (d7b28b4)

## Unreleased

- Collapse tool-use events by default behind expandable `Tool used: <tool>` cards in the chat stream.
- Add vault-native Sidekick `.agent.md` profiles with selectable model lists, disabled/read-only tool preferences, included memory files, `/agent` prompt selection, and starter research/writing/code/linking/glossary agents.
- Add generated `Sidekick/Prompts/*.prompt.md` prompt library starter files.
- Add `Sidekick/Memory/project-index.md` generation from Markdown filenames and top headings.
- Add explicit `.pi/` resource export for Sidekick prompt templates and vault-linker/glossary-curator skills.
- Add persistent sidebar controls for Sidekick agent profiles alongside the model rail.
- Prepare Pi session folders through the Obsidian vault adapter instead of runtime Node fs access.
- Clarify shell execution, Pi launch, safe command allowlist, and vault enumeration boundaries in public docs.

## 0.1.5 - 2026-05-27

- Merge remote-tracking branch 'origin/dev' (69325b6)
- Fix release version selection (c56d31d)
- Merge pull request #1 from HPuntu/dev (acab437)
- Merge branch 'main' into dev (59c8dbb)
- Fix community plugin review issues (667057f)

## 0.1.4 - 2026-05-27

- Merge remote-tracking branch 'origin/main' (cc643c1)
- up (f102b0d)

## 0.1.3 - 2026-05-27

- Merge remote-tracking branch 'origin/main' (7ca2ff7)
- readme update (d2fd1a5)

## 0.1.2 - 2026-05-27

- Merge remote-tracking branch 'origin/main' (8dc076f)
- several updates to ui (dab3a4a)

## 0.1.1 - 2026-05-27

- increased overall safety for web fetch and pdf accession among otheres ( see changelog) (8204eb6)
- versioning and package build release v0.10 implemented (3462dcf)
- readme update (fbb1639)
- release commit v0.1.0 (da82f01)
- up (69ad520)
- tool usage implemented (fa33b5e)
- light changes to some stdout readout (706c306)
- up (f468a92)
- made the status view panel smaller (2bc507f)
- added full session history, agent selection and Pi agent RCPa (c6eae36)
- initial commit (38b3bd8)

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
