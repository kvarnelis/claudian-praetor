# Claudian Praetor

![GitHub release](https://img.shields.io/github/v/release/kvarnelis/claudian-praetor)
![License](https://img.shields.io/github/license/kvarnelis/claudian-praetor)

A personal fork of **[Claudian](https://github.com/YishenTu/claudian)** by **[Yishen Tu](https://github.com/YishenTu)**. Claudian is his project and does all the real work — embedding Claude Code, Codex, and other AI coding agents in Obsidian, with your vault as their working directory. This fork adds a few things on top and tracks his releases.

**Currently synced with upstream Claudian `2.0.27`** (the latest upstream release).

> For what the plugin actually does and how to use it — the chat, file edits, providers, skills, MCP, plan mode — see **[Claudian](https://github.com/YishenTu/claudian)**. That's the source of truth. This README only covers what's different in the fork.

## What this fork adds

- **Mobile remote mode** — drive the agents running on your Mac from Obsidian on an iPhone or iPad, over a private [Tailscale](https://tailscale.com/download) connection. It's peer-to-peer (no cloud relay); your vault and prompts never leave your own devices. [Setup below](#mobile-remote-mode).
- **Grok provider** — adds Grok to Claudian's built-in set (Claude, Codex, OpenCode, Pi).
- **CLI-driven model list** — the Claude model picker is populated from whatever your installed Claude Code CLI reports, so new models (e.g. Fable) appear automatically instead of being hardcoded.
- **Date-based versioning** — this fork versions by date (e.g. `2026.7.1`) to stay clearly distinct from upstream's numbering.

## Install

Claudian Praetor isn't in the Obsidian community directory — install it via BRAT or a GitHub release. Requires Obsidian **1.7.2+**.

### BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Add the beta plugin repository `kvarnelis/claudian-praetor`.
3. Enable **Claudian Praetor** under Community plugins.

### Manual

Download `main.js`, `manifest.json`, `styles.css`, and `praetord.cjs` from the [latest release](https://github.com/kvarnelis/claudian-praetor/releases/latest) into `<vault>/.obsidian/plugins/claudian-praetor/`, then enable the plugin.

## Mobile remote mode

Runs the agents on your Mac and lets you drive them from a phone or iPad over Tailscale — peer-to-peer, no cloud. Available remotely for **Claude, Codex, and Grok**.

### On the Mac (host)

1. Install and connect [Tailscale](https://tailscale.com/download) — this gives the Mac a `100.x.y.z` tailnet address.
2. Open **Claudian Praetor settings → Mobile daemon** and enable **Host mobile daemon on this Mac**. That detects the Tailscale IP, writes `~/.config/claudian-praetor/daemon.json` (with a random auth token), starts the `praetord` daemon on port `8423`, and publishes the URL/token into plugin data.

The host toggle is stored only on that Mac and never syncs to your other desktops.

### On the phone/iPad (client)

1. Install Claudian Praetor via BRAT, and connect [Tailscale](https://tailscale.com/download) on the same account as the Mac.
2. Let Obsidian Sync carry the URL/token over automatically, or paste them manually under **Remote Mac daemon** — the URL is `ws://100.x.y.z:8423` and the token is the `token` value from `daemon.json` on your Mac.
3. Open the chat and pick a remote provider.

The daemon binds only to the Tailscale interface (not your LAN or the public internet), and the tunnel is encrypted by Tailscale/WireGuard end to end. The Mac must be awake with Obsidian open — the agents run on it, not in a cloud.

**If it won't connect:** confirm Tailscale is on and connected on both devices, the Mac is awake with the plugin loaded, and hosting is enabled. The daemon log is at `~/.config/claudian-praetor/praetord.log`.

## Credits

MIT. **Claudian and all of its core functionality are the work of [Yishen Tu](https://github.com/YishenTu)** — please support [the upstream project](https://github.com/YishenTu/claudian). This fork is maintained by [kvarnelis](https://github.com/kvarnelis).
