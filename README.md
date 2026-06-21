# Claudian Praetor

![GitHub release](https://img.shields.io/github/v/release/kvarnelis/claudian-praetor)
![License](https://img.shields.io/github/license/kvarnelis/claudian-praetor)

Claudian Praetor is a fork of Claudian that embeds AI coding agents in Obsidian and adds a Praetor remote mode for iPhone and iPad. On desktop it runs providers locally against your vault. On mobile it can connect over Tailscale to a daemon hosted by your Mac, so the mobile UI drives the same Claude Code, Codex, Grok, and other provider runtimes that already work on desktop.

## Features

- **Desktop agent chat** — Claude Code, Codex, Grok, Opencode, Pi, and related providers can read, search, and edit your vault.
- **Mobile remote mode** — iPhone/iPad clients connect to `praetord` on your Mac over WebSocket.
- **Machine-local daemon hosting** — the “Host mobile daemon on this Mac” setting is stored only on that Mac, so other synced Macs do not accidentally start hosting.
- **Synced mobile connection** — the Mac publishes the daemon URL/token to plugin data so Obsidian Sync can carry it to mobile devices.
- **Inline edit, slash commands, skills, MCP, multi-tab conversations, and plan mode** — inherited from Claudian/Praetor.

## Requirements

- Obsidian v1.7.2+
- Desktop Mac for local provider runtimes and optional mobile daemon hosting
- For mobile remote mode: [Tailscale](https://tailscale.com/download) on the Mac and the iPhone/iPad
- Provider CLIs or accounts as needed: [Claude Code](https://code.claude.com/docs/en/overview), [Codex CLI](https://github.com/openai/codex), [Opencode](https://opencode.ai/), Grok Build, or Pi

## Installation via BRAT or GitHub Release

This fork is released through GitHub/BRAT, not the Obsidian Community Plugin directory.

### BRAT

1. Install the Obsidian BRAT plugin.
2. Add beta plugin repository `kvarnelis/claudian-praetor`.
3. Enable **Claudian Praetor** in Community plugins.

### Manual GitHub release install

1. Download `main.js`, `manifest.json`, `styles.css`, and `praetord.cjs` from the latest release.
2. Create this folder in your vault:
   ```text
   /path/to/vault/.obsidian/plugins/claudian-praetor/
   ```
3. Copy all four files into that folder.
4. Enable **Claudian Praetor** in Obsidian.

## Desktop Setup

Open the Claudian Praetor settings tab and configure the providers you want to use. Desktop Obsidian uses local provider runtimes directly; it does not need the remote daemon unless you want mobile devices to connect to this Mac.

For mobile hosting:

1. Install and connect [Tailscale](https://tailscale.com/download) on the Mac.
2. In Claudian Praetor settings, open **Mobile daemon**.
3. Enable **Host mobile daemon on this Mac**.
4. Praetor detects the Mac’s Tailscale IP, creates or updates `~/.config/claudian-praetor/daemon.json`, starts `praetord`, and publishes the mobile URL/token through plugin data.

The host checkbox is local to this Mac. It does not sync to other desktop machines.

## Mobile Setup

1. Install Claudian Praetor in Obsidian mobile via BRAT.
2. Install and connect [Tailscale](https://tailscale.com/download) on the mobile device.
3. Let Obsidian Sync bring over the plugin data from the host Mac, or paste the URL/token manually in **Remote Mac daemon** settings.
4. Open Claudian Praetor and choose a remote-backed provider.

If the mobile client cannot connect, confirm that Tailscale is on, the Mac is awake, and the Mac setting **Host mobile daemon on this Mac** is enabled.

## Development

```bash
npm install
npm run build
npm run build:daemon
```

Set `OBSIDIAN_VAULT=/path/to/vault` while building to copy the built plugin files into the folder matching `manifest.id`.

## Release Assets

Every release must include:

- `main.js`
- `manifest.json`
- `styles.css`
- `praetord.cjs`

## Privacy & Data Use

- Provider requests send your prompt, selected files/images, and tool outputs to the configured provider.
- Local settings and sessions live in the vault and plugin storage.
- The Praetor daemon listens on the Mac’s Tailscale address when explicitly enabled on that Mac.
- The daemon token is stored in `~/.config/claudian-praetor/daemon.json` and copied to plugin data only so mobile devices can authenticate.

## Troubleshooting

### Tailscale is not detected

Turn on Tailscale on the Mac and confirm it has a `100.x.y.z` tailnet IP. The daemon host setting will not publish a new mobile URL until that address is available.

### Mobile says it cannot reach the daemon

Check that Tailscale is connected on both devices, the Mac is awake, Obsidian has loaded the plugin, and `praetord` is running. The daemon log is written to `~/.config/claudian-praetor/praetord.log` when possible.

### Provider CLI not found

Leave CLI path fields empty first so Claudian Praetor can auto-detect from PATH. If auto-detection fails, set the provider-specific CLI path in settings for this device.
