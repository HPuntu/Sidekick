# Release Checklist

Use this checklist before sharing a release publicly.

## Metadata

- [ ] Confirm `manifest.json` has the correct plugin id, name, description, author, author URL, version, and minimum Obsidian version.
- [ ] Confirm `package.json` has matching version, author, license, and release scripts.
- [ ] Confirm `versions.json` maps the release version to the minimum Obsidian version.
- [ ] Replace contributor placeholders with maintainer-specific details where appropriate.
- [ ] Confirm `LICENSE` matches the intended license.

## Build Health

- [ ] Run `npm install`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm audit --omit=dev`.
- [ ] Run `npm run release:zip`.
- [ ] Confirm `node_modules/` is not tracked by git.
- [ ] Confirm the release zip contains only `main.js`, `manifest.json`, and `styles.css`.

## Fresh Vault QA

- [ ] Install the release files into a fresh vault at `.obsidian/plugins/agent-dashboard/`.
- [ ] Enable the plugin from Obsidian settings.
- [ ] Open the dashboard from the command palette.
- [ ] Confirm the dashboard opens in the right sidebar.
- [ ] Confirm status panel scrolling and agent panel layout.
- [ ] Confirm session history appears on first open.
- [ ] Start a new chat by typing in the composer.
- [ ] Confirm model chips appear after Pi RPC discovery.
- [ ] Switch models from the model rail.
- [ ] Send a basic prompt with Pi tools disabled.
- [ ] Stop a running prompt.
- [ ] Start a second persistent session and switch between sessions.
- [ ] Export a chat and confirm it appears in `Chats/`.

## Vault Context QA

- [ ] Mention a Markdown file with `@` from the chat page.
- [ ] Mention a Markdown file with `@` from the session landing page.
- [ ] Mention a file inside a folder with spaces.
- [ ] Mention a wiki-style path.
- [ ] Mention a PDF that contains selectable text.
- [ ] Mention a scanned or unsupported PDF and confirm the warning is clear.
- [ ] Use `@search(query)`.
- [ ] Use `@semantic(query)`.
- [ ] Use `@vault-index`.
- [ ] Use `@links`.
- [ ] Use `@cmd(git status)` with the command allowlisted.
- [ ] Confirm a non-allowlisted `@cmd(...)` is blocked.
- [ ] Enable web fetch and use `@url(...)` with an allowed public host.
- [ ] Confirm localhost/private URL fetches are blocked.

## Safety QA

- [ ] Keep Pi tools disabled and confirm prompts include `--no-tools`.
- [ ] Enable read-only Pi tools and confirm only `read`, `grep`, `find`, and `ls` are enabled.
- [ ] Confirm shell/write/delete requests are blocked by the safety guard.
- [ ] Trigger a sample approval request.
- [ ] Deny a proposed edit and confirm no file changes.
- [ ] Approve a proposed Markdown edit and confirm the file changes.
- [ ] Confirm stale edit protection by changing a file before applying a proposal.
- [ ] Run `Suggest internal links for current note` and inspect the diff before applying.

## Public Release

- [ ] Add screenshots or a short demo GIF to the README.
- [ ] Add final known limitations.
- [ ] Tag the release in git.
- [ ] Upload release assets: `main.js`, `manifest.json`, `styles.css`, and the zip.
- [ ] Mark the release as alpha or beta until tested by external users.
- [ ] For Obsidian Community Plugin submission, follow Obsidian's current submission requirements and community plugin review process.
