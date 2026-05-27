# Security

Local Sidekick is a local-first Obsidian plugin for working with Pi, Ollama, and vault files. It is alpha software. Treat it as a powerful local automation surface and test it in a copied vault before using it on important notes.

## Supported Versions

| Version | Support |
| --- | --- |
| 0.1.x alpha | Best-effort fixes while the project is under active development |

## Local Data

The plugin can read files from the active Obsidian vault when you mention them with `@` or use vault context helpers. Optional external workspace roots are read-only and must be configured explicitly.

The plugin does not intentionally send data to hosted AI providers. Model prompts are sent to the configured local Pi and Ollama processes. If you enable web fetch, requested HTTPS URLs from explicitly allowlisted hosts are fetched directly by the plugin and included as prompt context.

Settings, chat history, proposed edits, approvals, and session metadata are stored in the plugin data file in the vault configuration. That data may include prompts, model replies, note excerpts, proposed file contents, and local settings. It can be synced or backed up if your sync tool includes `.obsidian`, so treat `.obsidian/plugins/local-sidekick/data.json` as private vault data.

## Tool Boundaries

Default behavior is conservative:

- Pi tools are disabled by default.
- Read-only Pi mode enables only `read`, `grep`, `find`, and `ls`.
- Pi `bash`, edit, and write tools are disabled by the plugin.
- The plugin does launch local processes for Pi integration. This is required for local agent execution, model discovery, model switching, and prompt streaming.
- Pi and safe commands are launched without a shell, so shell expansion, pipes, redirects, and command chaining are not available through these paths.
- The Pi executable is `pi` by default. Non-default executable paths require once-per-Obsidian-session confirmation because vault settings can be imported from elsewhere.
- Safe commands are exact allowlist entries only and can be configured in settings.
- The default safe command allowlist is intentionally narrow: `git status` and `git diff --stat`.
- File writes require reviewed Markdown diffs and explicit approval.
- Deletes are blocked.
- URL fetching is disabled by default.
- URL fetching requires HTTPS and an explicit host allowlist.
- URL fetching resolves DNS and blocks localhost, private, link-local, reserved, multicast, and metadata-style addresses.

## Experimental Pi Features

Prompt runs pass flags that disable Pi extensions, skills, prompt templates, and context files by default. This keeps Local Sidekick's context path narrow and easier to audit.

The `Experimental` settings section can allow Pi to load those features by removing the disabling flags. Enable this only if you trust your Pi configuration and understand that extensions, skills, prompt templates, or context files may add behavior and context outside Local Sidekick's tested safety path.

Pi tools are also disabled by default. The only exposed Pi tool mode is read-only `read`, `grep`, `find`, and `ls`; broader Pi tool modes are not exposed by the plugin UI yet.

## Untrusted Vault Settings

Obsidian plugin data lives inside the vault. If you open a vault from someone else, its plugin data may contain a changed Pi executable path, safe command allowlist, web fetch allowlist, or experimental feature settings. Local Sidekick confirms non-default Pi executable paths once per Obsidian session before use. It also confirms before launching Pi with experimental extensions, skills, prompt templates, and context files enabled. You should still inspect settings before running the agent in an untrusted vault.

## Known Risks

- Local models can hallucinate paths, commands, facts, and edits.
- A model with tool support may still misunderstand tool output.
- Best-effort PDF extraction can miss text or fail on scanned, encrypted, malicious, or unusual PDFs. Compressed and decompressed stream limits reduce denial-of-service risk but do not make the parser a complete PDF sandbox.
- Approved edits are real writes to your vault.
- Vault search, file mentions, the vault index helper, and internal-link suggestions enumerate vault files locally so they can offer relevant context and path suggestions.
- Safe commands are only as safe as the commands you allowlist. Package-manager scripts can execute arbitrary project code and should not be added unless you trust the repo.
- Any optional web fetch feature can expose requested URLs to the remote server hosting that URL.

## Recommendations

- Keep Pi tools disabled unless you need them.
- Prefer explicit `@` file context and local search helpers for factual tasks.
- Keep the safe command allowlist short; prefer read-only commands like `git status` and `git diff --stat`.
- Review every diff before approval.
- Use version control or vault backups.
- Test releases in a copied vault before using them in a daily vault.

## Reporting Issues

Please report security issues privately through GitHub Private Vulnerability Reporting for this repository, if available. If that route is unavailable, open a minimal public issue asking for a private contact path and do not include exploit details, private vault contents, tokens, prompts, or proof-of-concept payloads in the public issue.
