# Pocket Codex

![GitHub release](https://img.shields.io/github/v/release/kvarnelis/claudian-praetor)
![License](https://img.shields.io/github/license/kvarnelis/claudian-praetor)

![Preview](assets/Preview.png)

Pocket Codex embeds coding agents directly in Obsidian. Claude Code, Codex, and
Grok can work with the active vault through a shared sidebar chat,
while provider-native sessions, models, permissions, and tools remain under
each provider's control.

Pocket Codex includes multi-tab conversations, streaming responses and tool calls,
conversation history, plan and permission controls, diffs, file and image
context, slash commands, skills, MCP servers, subagents, inline editing, live
model discovery, and an optional theme-native interface. Its mobile remote mode
lets an iPhone or iPad use Claude, Codex, or Grok running on a Mac over a private
Tailscale connection.

Pocket Codex is maintained as an independent project. It does not track Claudian
releases and has no upstream-merge schedule.

## Install

Pocket Codex requires Obsidian 1.7.2 or later and is not in the Obsidian community
plugin directory.

### BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. Add `kvarnelis/claudian-praetor` as a beta plugin repository.
3. Enable **Pocket Codex** under Community plugins.

The GitHub repository keeps the historical name `kvarnelis/claudian-praetor`
for now, but the Obsidian plugin id and install folder are both `pocket-codex`.

If you previously installed Claudian Praetor, follow [MIGRATION.md](MIGRATION.md)
instead of enabling both plugins together.

### Manual

Download `main.js`, `manifest.json`, `styles.css`, and `pocket-codexd.cjs` from the
[latest release](https://github.com/kvarnelis/claudian-praetor/releases/latest)
into `<vault>/.obsidian/plugins/pocket-codex/`, then enable **Pocket Codex**.

## Core workflow

- Open Pocket Codex from the ribbon or command palette and choose a provider.
- Start several independent conversations in tabs and resume provider-native
  history when supported.
- Attach vault files, images, selections, canvas context, or configured external
  context to a turn.
- Review streamed tool calls, plans, edits, diffs, todos, and subagent results.
- Use inline edit from an active Markdown note to insert or replace text.
- Configure provider models, reasoning controls, permissions, commands, skills,
  MCP servers, environment variables, and CLI locations in Pocket Codex settings.

Provider capabilities differ by design. A control appears only when its
provider supports that behavior.

In settings, Codex can mean Pocket Codex itself or the OpenAI Codex provider.

## Mobile remote mode

Mobile remote mode runs provider sessions, credentials, vault access, and tool
execution on a desktop Mac while the Obsidian interface runs on an iPhone or
iPad. The devices communicate over Tailscale; `pocket-codexd` binds to the Mac's
Tailscale address rather than the public internet or general LAN interface.

### Mac host

1. Install and connect [Tailscale](https://tailscale.com/download) on the Mac.
2. In **Pocket Codex settings -> Mobile daemon**, enable **Host mobile daemon on this Mac**.
3. Pocket Codex starts `pocket-codexd` on port `8423` and stores its configuration under
   `~/.config/claudian-praetor/` for compatibility with existing deployments.
4. Choose **Pair iPhone or iPad** when adding a device. Pairing remains open for
   five minutes.

### iPhone or iPad

1. Install Pocket Codex through BRAT and connect Tailscale to the same tailnet.
2. Let Obsidian Sync carry the remote Mac URL, or enter the URL in Pocket Codex's
   remote daemon setting.
3. Open Pocket Codex while the Mac pairing window is active.
4. Choose a remote Claude, Codex, or Grok provider.

The Mac must remain awake with Obsidian running. Do not expose `pocket-codexd`
publicly: its `ws://` transport relies on Tailscale for encryption and access
control. See [daemon/README.md](daemon/README.md) for deployment details.

## Data compatibility

Pocket Codex intentionally continues using `.claudian/`, `.claude/`, `.codex/`, and
the other existing provider-native vault paths. Renaming them would strand
settings, sessions, commands, skills, and history. The old paths are a data
compatibility contract, not residual product identity.

On first run, Pocket Codex also copies the old Claudian Praetor plugin `data.json`
into its own plugin data when Pocket Codex has no saved data. It never moves,
rewrites, or deletes the old file. See [MIGRATION.md](MIGRATION.md).

## Credits / origins

Pocket Codex is built on [Claudian](https://github.com/YishenTu/claudian) by
[Yishen Tu](https://github.com/YishenTu), released under the MIT License. That
project supplied the foundation and substantial portions of the code in this
repository. Pocket Codex is now maintained independently by
[Kazys Varnelis](https://github.com/kvarnelis) and no longer tracks Claudian
upstream releases. Independence does not erase Claudian's authorship.

## License

MIT. See [LICENSE](LICENSE).
