# Safety Review — Local Sidekick

Scope: the working tree as of the unreleased changes (post-0.2.3), reviewed for
public release. This is a review of what the plugin **can** do on a user's
machine and vault, not a claim that it is safe or unsafe.

Reviewed by reading every process-spawn, network-egress, and disk-write site in
`src/`, plus the safety policy and its tests.

---

## 1. Summary for a release note

Local Sidekick can, on a user's computer:

- **Launch a local process** (`pi`) with arguments the plugin controls, with its
  working directory set to the vault root.
- **Read any file in the vault**, and any file under folders the user adds to
  `Allowed external workspace roots`.
- **Run shell commands** from a user-maintained allowlist, without a shell, only
  when the user types `@cmd(...)` in a prompt.
- **Make outbound HTTPS requests** to an explicit host allowlist, only when the
  user enables web fetch (off by default).
- **Write Markdown files into the vault**, only after the user approves a
  specific proposed edit and reviews its diff.
- **Talk to a local Ollama server** at the configured host.

It does not delete files, does not write outside the vault, has no telemetry,
and makes no network requests other than to Ollama and allowlisted hosts.

---

## 2. The most important thing to understand

**The plugin does not enforce which tools Pi may use. Pi does.** (Confirmed
against Pi's documentation — see section 4.)

The restriction is a command-line argument, applied at spawn
(`src/bridge/pi/PiReadOnlyPrompt.ts`):

```
--tools read,grep,find,ls         # tool mode "read-only" (default)
--no-tools                        # tool mode "disabled"
```

`onToolEvent` in `src/main.ts` sees any other tool only as a report: a tool
event is Pi *stating that it called a tool*. By the time the plugin sees it, the
call has already happened. The plugin has no interception point.

Fixed in this release: the UI previously said "Blocked" and queued an approval,
implying prevention and offering a decision that could no longer matter. It now
reads `Ran outside allowlist: ...` and records a warning instead.

Consequences to state plainly in user-facing docs:

- The security boundary is Pi's correct implementation of its own flags.
- If a Pi version ignores, renames, or scopes those flags differently, the
  plugin will not notice.
- Pinning or checking a minimum Pi version is not currently done.

## 3. What `SafetyPolicy` actually governs

`assessSafetyRequest` / `isPathInsideAnyRoot` gate **the plugin's own file
reads and its approved writes**. They do not gate Pi's tool calls.

| Action | Gated by SafetyPolicy? |
|---|---|
| Plugin reads a note for `@mention`, Note/Selection/Vault context, pinned notes | Yes |
| Plugin applies an approved proposed edit | Yes |
| Plugin runs an allowlisted `@cmd(...)` | Yes |
| **Pi's own `read`/`grep`/`find`/`ls` in read-only mode** | **No** |

Pi is spawned with `cwd` set to the vault root, but nothing in this codebase
confines Pi to that directory. Whether Pi's `read` can open an absolute path
outside the vault is a Pi behaviour, unverified here.

## 4. Pi extensions — resolved, default reverted

This release briefly enabled Pi extensions, skills, prompt templates, and
context files by default, dropping the flags every spawn used to pass:

```
--no-extensions --no-skills --no-prompt-templates --no-context-files
```

That mattered more than a normal default change because of section 2:

1. Pi would load configuration the plugin did not author and cannot inspect.
2. The plugin also *writes* to `.pi/` itself (`exportSidekickPiResources`), so
   `.pi/` is an expected part of a vault — a shared or downloaded vault
   carrying a crafted `.pi/` would be loaded without a prompt.
3. **RESOLVED — and the answer is negative.** Pi's `--tools` and `--no-tools`
   filter Pi's **built-in** tools only. Tools registered by an extension via
   `pi.registerTool()` remain available regardless. Pi's own README, quoted in
   [earendil-works/pi#2835](https://github.com/earendil-works/pi/issues/2835):

   > `--no-tools` — Disable all built-in tools (extension tools still work)

   With extensions enabled, neither `--no-tools` nor `--tools read,grep,find,ls`
   has any force.

**Action taken:** the setting (since renamed `allowPiUserConfig`) reverted to `false`. Passing
`--no-extensions` is the only thing that makes the tool restriction meaningful,
so it must remain the default. The setting stays available for users who trust
every extension their Pi configuration loads, and its description now says
plainly that enabling it removes the plugin's ability to bound Pi.

Note: issue #2835 is closed but carries an "inprogress" label, so a later Pi
version may change this. Nothing here should assume it has been fixed without
testing against a specific version.

## 5. Untrusted-vault surface

`data.json` lives inside the vault, so opening someone else's vault means
adopting their plugin settings.

Confirmed once per Obsidian session before use:

- Non-default `Pi executable` path — good, this is the highest-value setting to
  gate, since it decides which binary runs.

**Not** confirmed:

| Setting | Effect if pre-seeded by an untrusted vault | Residual mitigation |
|---|---|---|
| `safeCommandAllowlist` | Adds commands that `@cmd(...)` will run | User must type the exact command; no shell metacharacters |
| `webFetchAllowedHosts` | Widens fetch targets | Web fetch is off by default |
| `allowedExternalWorkspaceRoots` | Widens plugin reads and approved-write targets | Writes still need per-edit approval and are `.md`-only |
| `sidekickRootFolder` | Redirects where profiles/memory are read from | Contents still only become prompt context |
| `allowPiUserConfig` | Removes the plugin's ability to bound Pi's tools | `false` by default; **no confirmation** if a vault ships it as `true` |

The confirmation dialog for Pi extras was removed in this release. Given
section 4, restoring a confirmation for a vault-supplied `true` is now the
highest-value outstanding item.

## 6. Prompt injection

Vault content, fetched pages, command output, and — in read-only mode — files
Pi reads itself all enter the prompt. Any of it can carry instructions.

The realistic escalation path is a malicious note persuading the model to
propose a harmful edit. That is contained by the edit pipeline, which is the
strongest part of the design:

- Edits are proposals, never applied automatically.
- Each requires an explicit per-edit approval.
- A diff is rendered before applying.
- Markdown files only.
- Paths are normalised and traversal outside the vault returns empty
  (`normalizeProposedEditPath`, tested).
- Stale proposals are detected if the file changed underneath.

## 7. What is well built

Stated for balance; these held up under review.

**Web fetch** (`src/tools/WebFetch.ts`) is careful work:
HTTPS only; empty allowlist denies everything; hostname must match the
allowlist or be a subdomain; DNS is resolved and the address **pinned** for the
connection, which defeats DNS rebinding; localhost, private, link-local,
reserved, multicast, and cloud-metadata ranges are refused, including
`::ffff:`-mapped IPv4; redirects are not followed; body and output are capped.
Covered by 27 tests.

**Safe commands** (`src/tools/SafeCommands.ts`): `execFile` with `shell: false`,
rejection of any command containing `; & | < > \` $`, exact allowlist match after
whitespace normalisation, output cap, timeout.

**Path containment**: `isPathInsideAnyRoot` resolves both sides and rejects
traversal and shared-prefix siblings. Tested.

**No phoning home**: `PI_SKIP_VERSION_CHECK=1` is set on every Pi child, and the
plugin has no telemetry. Outbound traffic is Ollama plus allowlisted hosts only.

**No listening sockets**: the vestigial loopback `/health` bridge has been
removed. The plugin now opens no ports at all.

## 8. Recommendations before public release

**Done in this pass:**

1. ~~Determine whether `--tools` constrains extension-provided tools~~ — it does
   not (section 4). The setting, since renamed `allowPiUserConfig`, reverted
   to `false`.
2. ~~State in README and SECURITY.md that tool restriction is enforced by Pi~~ —
   both now carry a "who enforces tool restrictions" section, including that Pi
   is not confined to the vault by this plugin.
3. ~~Stop the UI claiming to block a tool that already ran~~ — now reports
   `Ran outside allowlist: ...` and no longer queues a meaningless approval.
4. ~~Emphasise that vault content and prompt injection are the user's
   responsibility~~ — stated in both documents.

**Still outstanding, in priority order:**

5. **Confirm a vault-supplied `allowPiUserConfig: true`.** Since
   enabling it removes the tool boundary entirely, a vault that ships it as
   `true` is the sharpest remaining untrusted-vault edge. Confirm on first use
   when the value came from vault data rather than the settings UI.
6. **Record a minimum supported Pi version and check it at probe time.**
   `PiProbe` already runs `--version`; nothing yet compares it. Without this,
   the plugin cannot tell whether the flags it relies on behave as expected.
7. **Consider confirming `safeCommandAllowlist` entries** that did not originate
   in the settings UI.

## 9. Coverage note

161 tests cover the security-relevant pure functions: path containment, the
tool-mode decision, command parsing and allowlisting, host allowlisting and IP
blocking, mention resolution, and path normalisation. Two deliberate mutations
(removing the `..` traversal guard; allowing the link-local range) were
confirmed to fail the suite.

Not covered by tests, because they are integration behaviour: the Pi spawn
arguments actually reaching Pi, Pi's honouring of them, the approval-to-apply
flow end to end, and anything involving the Obsidian API.
