# Security

Local Sidekick is a local-first Obsidian plugin for working with Pi, Ollama, and vault files. It is alpha software. Treat it as a powerful local automation surface and test it in a copied vault before using it on important notes.

## Supported Versions

| Version | Support |
| --- | --- |
| 0.1.x alpha | Best-effort fixes while the project is under active development |

## Local Data

The plugin can read files from the active Obsidian vault when you mention them with `@` or use vault context helpers. Optional external workspace roots are read-only and must be configured explicitly.

The plugin does not intentionally send data to hosted AI providers. Model prompts are sent to the configured local Pi and Ollama processes. If you enable web fetch, requested public URLs are fetched directly by the plugin and included as prompt context.

## Tool Boundaries

Default behavior is conservative:

- Pi tools are disabled by default.
- Read-only Pi mode enables only `read`, `grep`, `find`, and `ls`.
- Pi `bash`, edit, and write tools are disabled by the plugin.
- Safe commands are exact allowlist entries only.
- Safe commands run without a shell.
- File writes require reviewed Markdown diffs and explicit approval.
- Deletes are blocked.
- URL fetching is disabled by default.
- URL fetching blocks localhost and private network addresses.

## Known Risks

- Local models can hallucinate paths, commands, facts, and edits.
- A model with tool support may still misunderstand tool output.
- Best-effort PDF extraction can miss text or fail on scanned, encrypted, or unusual PDFs.
- Approved edits are real writes to your vault.
- Safe commands are only as safe as the commands you allowlist.
- Any optional web fetch feature can expose requested URLs to the remote server hosting that URL.

## Recommendations

- Keep Pi tools disabled unless you need them.
- Prefer explicit `@` file context and local search helpers for factual tasks.
- Keep the safe command allowlist short.
- Review every diff before approval.
- Use version control or vault backups.
- Test releases in a copied vault before using them in a daily vault.

## Reporting Issues

For now, report security issues privately to the maintainer channel attached to the release. If this repository is published publicly, add a private vulnerability reporting route before broad distribution.
