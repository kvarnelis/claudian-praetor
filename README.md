# Claudian Praetor

![GitHub release](https://img.shields.io/github/v/release/kvarnelis/claudian-praetor)
![License](https://img.shields.io/github/license/kvarnelis/claudian-praetor)

A personal fork of **[Claudian](https://github.com/YishenTu/claudian)** by **[Yishen Tu](https://github.com/YishenTu)**. Claudian is his project and does all the real work — embedding Claude Code, Codex, and other AI coding agents in Obsidian, with your vault as their working directory. This fork adds a few things on top and tracks his releases.

**Currently synced with upstream Claudian `2.0.27`** (the latest upstream release).

> For what the plugin actually does and how to use it — the chat, file edits, providers, skills, MCP, plan mode — see **[Claudian](https://github.com/YishenTu/claudian)**. That's the source of truth. This README only covers what's different in the fork.

## What this fork adds

- **Mobile remote mode** — drive the agents running on your Mac from Obsidian on an iPhone or iPad, over a private [Tailscale](https://tailscale.com/download) connection. It's peer-to-peer (no cloud relay); your vault and prompts never leave your own devices. [Setup below](#mobile-remote-mode).
- **Grok provider** — adds Grok to Claudian's built-in set (Claude, Codex, OpenCode, Pi).
- **Live model lists** — the Claude and Codex model pickers read their models directly from your installed CLIs at runtime, so they always show exactly what each CLI supports and pick up new models on their own. No hardcoded list to keep updated.
- **Date-based versioning** — this fork versions by date (e.g. `2026.7.2`) to stay clearly distinct from upstream's numbering.

## Install

Claudian Praetor isn't in the Obsidian community directory — install it via BRAT or a GitHub release. Requires Obsidian **1.7.2+**.

### BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Add the beta plugin repository `kvarnelis/claudian-praetor`.
3. Enable **Claudian Praetor** under Community plugins.

### Manual

Download `main.js`, `manifest.json`, `styles.css`, and `praetord.cjs` from the [latest release](https://github.com/kvarnelis/claudian-praetor/releases/latest) into `<vault>/.obsidian/plugins/claudian-praetor/`, then enable the plugin.

## Mobile remote mode

Runs the agents on your Mac and lets you drive them from a phone or iPad. There's **no cloud service** in the loop — it's peer-to-peer over [Tailscale](https://tailscale.com/download) (a private WireGuard mesh), so your vault and prompts never touch a third-party relay. Available remotely for **Claude, Codex, and Grok**.

### How it works

- Your Mac runs a small WebSocket daemon, `praetord`, listening on `ws://<your-Mac's-tailscale-IP>:8423`.
- It **binds only to the Tailscale interface** (the `100.x.y.z` CGNAT address) — not `0.0.0.0` — so it's invisible to your LAN and the public internet.
- Mobile devices pair with the Mac during a short pairing window. Pairing is stored locally in `~/.config/claudian-praetor/daemon.json`; no bearer token is synced through Obsidian.
- The transport is plaintext `ws://`, which is fine here because **Tailscale/WireGuard already encrypts the whole tunnel end to end**, and only devices signed into your tailnet can reach it. Keep Tailscale connected on both devices whenever you use mobile remote mode, even at home.

### On the Mac (host)

1. Install and connect [Tailscale](https://tailscale.com/download), signed into your account. Confirm it has a `100.x.y.z` IP.
2. Open **Claudian Praetor settings → Mobile daemon** and enable **Host mobile daemon on this Mac**.
3. That one toggle does everything: detects the Tailscale IP, writes `~/.config/claudian-praetor/daemon.json`, starts `praetord` on port `8423`, and publishes the `ws://` URL into plugin data for Obsidian Sync.
4. When adding a phone or iPad, click **Pair iPhone or iPad**. Pairing stays open for five minutes.

The host toggle and paired-device list are stored only on that Mac, so your other synced desktops won't start hosting and paired devices are not copied between Macs.

### On the phone/iPad (client)

1. Install Claudian Praetor via BRAT, and install/connect [Tailscale](https://tailscale.com/download) on the device, signed into the **same account** as the Mac.
2. Keep Tailscale connected. This is what makes the Mac reachable away from home, and the daemon is intentionally bound to the Tailscale address.
3. Let Obsidian Sync carry the published URL from the Mac, or paste it in **Remote Mac daemon** settings (`ws://100.x.y.z:8423`).
4. While the Mac's pairing window is open, open Claudian Praetor on mobile. The device pairs automatically on first connection.
5. Open the chat and pick a remote provider — Claude, Codex, or Grok.

### If it won't connect

Confirm Tailscale is on and connected on **both** devices, the Mac is awake with Obsidian loaded, and hosting is enabled. The daemon only publishes and works once the Mac has its `100.x` Tailscale IP. The daemon log is at `~/.config/claudian-praetor/praetord.log`.

Two things worth knowing:

- The Mac must be **awake and running Obsidian** — there's no always-on cloud instance; the agents literally run on your Mac.
- If you wanted *cloud* hosting (a public URL reachable without Tailscale), that isn't a feature — and you shouldn't expose `praetord` publicly, since it's plaintext `ws://` and relies on Tailscale for encryption and reachability.

## Credits

MIT. **Claudian and all of its core functionality are the work of [Yishen Tu](https://github.com/YishenTu)** — please support [the upstream project](https://github.com/YishenTu/claudian). This fork is maintained by [kvarnelis](https://github.com/kvarnelis).
