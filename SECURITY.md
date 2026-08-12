# Security

Local Sidekick runs a local AI agent against your Obsidian vault. It is alpha software. Test it in a copied vault before using it on notes you care about.

**By design, the agent reads your vault.** The default configuration launches Pi with read-only tools (`read`, `grep`, `find`, `ls`) rooted at the vault, so the model can open and search your notes on its own initiative. That is the plugin's purpose, not an optional extra. Writing, deleting, shell execution, and network access are separately restricted, as described below.

**One setting disables those restrictions.** `Allow Pi extensions and user configuration` is off by default. Enabling it allows unverified agent code to run through Pi, outside every boundary this document describes. Users may reasonably want that; the consequences are theirs.

## Supported Versions

| Version | Support |
| --- | --- |
| 0.1.x alpha | Best-effort fixes while the project is under active development |

## Local Data

With the default read-only tool mode, Pi can open and search any file in the vault on its own initiative. The plugin additionally reads files you mention with `@`, vault context helpers, pinned notes, and Sidekick `.agent.md` profiles with their included prompt or memory files. Optional external workspace roots are read-only and must be configured explicitly.

The plugin does not intentionally send data to hosted AI providers. Model prompts are sent to the configured local Pi and Ollama processes. If you enable web fetch, requested HTTPS URLs from explicitly allowlisted hosts are fetched directly by the plugin and included as prompt context.

Settings, chat history, proposed edits, approvals, and session metadata are stored in the plugin data file in the vault configuration. That data may include prompts, model replies, note excerpts, proposed file contents, and local settings. It can be synced or backed up if your sync tool includes `.obsidian`, so treat `.obsidian/plugins/local-sidekick/data.json` as private vault data.

## Sidekick Agent Profiles

Sidekick profiles are Markdown files in the vault, usually under `Sidekick/Agents/*.agent.md`, with optional includes under `Sidekick/Prompts/` and `Sidekick/Memory/`. Treat them like local configuration: they can add prompt instructions, select preferred local models, include note excerpts or summaries, and request either disabled or read-only Pi tool mode.

Profiles cannot request Pi bash, edit, or write tools through Local Sidekick; they may only ask for disabled or read-only mode. They can still influence a local model's behavior, so inspect profile and memory files before using a vault from someone else.

The explicit `Export Sidekick Pi resources` command writes `.pi/prompts`, `.pi/skills`, and merges entries into `.pi/settings.json`. This can affect Pi runs started directly from the vault root, so inspect generated `.pi/` files before using them with Pi outside Local Sidekick.

## Tool Boundaries

What the shipped defaults allow and refuse:

- Pi reads the vault: tools default to read-only `read`, `grep`, `find`, and `ls`.
- Pi extensions, skills, prompt templates, and context files are disabled, which is what makes that restriction hold.
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

## Who Enforces Tool Restrictions

**Pi does, not this plugin.** Local Sidekick restricts tools by passing arguments when it launches Pi:

- `--tools read,grep,find,ls` for the default `Read-only` mode
- `--no-tools` for `Disabled` mode

That argument is the entire boundary. Local Sidekick has no way to intercept a tool call. When the sidebar shows `Ran outside allowlist: ...`, Pi has **already executed** that tool; the entry is a report, not a prevention. Treat it as a signal that your Pi setup is not behaving as the plugin requested.

Two consequences:

- The guarantee is only as good as Pi's implementation of those flags. Local Sidekick does not verify Pi's version or behaviour.
- Pi's read-only tools run with the working directory set to your vault, but **this plugin does not confine Pi to the vault**. Whether Pi can read paths outside it is Pi's behaviour, not something Local Sidekick controls.

## Pi Extensions, Skills, Prompt Templates, And Context Files

Prompt runs pass flags that disable Pi extensions, skills, prompt templates, and context files by default. This is a security control, not a convenience default.

Pi's `--tools` and `--no-tools` flags filter Pi's **built-in** tools only. Tools registered by an extension through `pi.registerTool()` remain available regardless — Pi's own documentation states that `--no-tools` disables built-in tools while "extension tools still work" (see [earendil-works/pi#2835](https://github.com/earendil-works/pi/issues/2835)). Passing `--no-extensions` is therefore what makes the tool restriction meaningful at all.

Turning on `Allow Pi extensions and user configuration` means:

- Extensions from your Pi configuration load, and any tools they register are available to the model.
- The `Pi tools` setting no longer bounds what Pi can do.
- A vault carrying a crafted `.pi/` directory can contribute extensions and context. Local Sidekick itself writes to `.pi/`, so its presence in a vault is not unusual.

Only enable it if you wrote or trust every extension your Pi configuration loads.

Pi tools are a separate setting, defaulting to **Read-only**: Pi's built-in `read`, `grep`, `find`, and `ls` are available from the vault root, while `bash`, `edit`, and `write` are not. `Disabled` removes Pi's tools entirely. Broader Pi tool modes are not exposed by the plugin UI.

This pairing is deliberate. Read-only tools are useful only if the restriction holds, and it holds only while Pi extensions are disabled. Enabling extensions removes the guarantee for both settings at once.

## Prompt Injection Is Your Responsibility

Vault notes, fetched pages, command output, and files Pi reads all enter the prompt, and any of them can contain text that tries to steer the model. Local Sidekick contains the consequences — edits are proposals requiring per-edit approval with a visible diff, restricted to Markdown inside the vault — but it cannot detect a malicious instruction inside a note. Review what you open, especially vaults you did not create.

## Untrusted Vault Settings

Obsidian plugin data and Sidekick profile files live inside the vault. If you open a vault from someone else, its plugin data may contain a changed Pi executable path, safe command allowlist, web fetch allowlist, selected profile, profile/memory files, or existing `.pi/` resources. Local Sidekick confirms non-default Pi executable paths once per Obsidian session before use.

Pi extensions, skills, prompt templates, and context files are disabled by default, so an untrusted vault cannot introduce Pi extensions on its own. It can, however, ship plugin data with `allowPiUserConfig` already set to `true`, and that value is **not** currently confirmed before use. Inspect settings, `Sidekick/`, and `.pi/` before running the agent in a vault you did not create.

## Known Risks

- Local models can hallucinate paths, commands, facts, and edits.
- A model with tool support may still misunderstand tool output.
- Best-effort PDF extraction can miss text or fail on scanned, encrypted, malicious, or unusual PDFs. Compressed and decompressed stream limits reduce denial-of-service risk but do not make the parser a complete PDF sandbox.
- Approved edits are real writes to your vault.
- Vault search, file mentions, Sidekick project-index generation, the vault index helper, and internal-link suggestions enumerate vault files locally so they can offer relevant context and path suggestions.
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
