# Claudian Praetor

![GitHub release](https://img.shields.io/github/v/release/kvarnelis/claudian-praetor)
![License](https://img.shields.io/github/license/kvarnelis/claudian-praetor)

Chat with AI coding agents in your Obsidian sidebar — they read, search, and edit the notes in your vault while you work. Claudian Praetor extends [Claudian](https://github.com/YishenTu/claudian) with more providers and a remote mode that lets an iPhone or iPad drive the agents running on your Mac.

![Claudian Praetor running beside a note in Obsidian](assets/Preview.png)

> **A fork, standing on Claudian's shoulders.** The entire core chat experience comes from [Claudian](https://github.com/YishenTu/claudian) by [Yishen Tu](https://github.com/YishenTu). This fork adds extra providers and the Praetor mobile remote mode. If you don't need those, use upstream Claudian.

## What it does

Open the chat in a sidebar and talk to an agent that has your vault as its working directory. It can:

- **Read and search** across your notes to answer questions with real context.
- **Write and edit files**, shown as inline diffs you approve before they land.
- **Run shell commands** and multi-step workflows to get real work done.
- **Call MCP tools**, use skills, and spawn subagents for parallel work.
- **Work across multiple tabs**, fork a conversation, or rewind to an earlier point.

### Driving the chat

The input box understands a few prefixes and modes:

| Input | Does |
|-------|------|
| `@` | Mention a note to add it to the agent's context |
| `/` | Run a slash command (built-in or from `.claude/commands`) |
| `#` | Instruction mode — refine the agent's standing instructions |
| `$` | Invoke a skill |
| `!` | Run a shell command directly, bypassing the agent |
| `Shift+Tab` | Toggle **plan mode** — the agent proposes a plan before touching anything |

Model, thinking/effort level, and the permission mode (including a **Yolo** auto-approve toggle) are all set from the toolbar under the input box.

> ⚠️ **These agents act on your machine.** They can run shell commands and create, edit, and delete files in your vault. Review changes before approving them, keep your vault in version control, and understand that **Yolo mode approves every action automatically**. Turn it on only when you trust the task.

## Providers

- **Claude Code** — the primary, full-featured provider.
- **Codex** — broadly supported (streaming, resume, fork, plan mode, images, inline edit, skills, subagents).
- **Grok, OpenCode, and Pi** — additional providers with varying levels of support.

All providers run on desktop. [Mobile remote mode](#mobile-remote-mode-praetor) currently supports **Claude, Codex, and Grok**.

You supply the provider's CLI or account; Claudian Praetor drives it.

## Requirements

- Obsidian **v1.7.2+**
- **Desktop** (macOS, Windows, or Linux) to run providers locally against your vault
- The provider CLIs or accounts you plan to use, for example: [Claude Code](https://code.claude.com/docs/en/overview), [Codex CLI](https://github.com/openai/codex), [OpenCode](https://opencode.ai/), Grok, or Pi
- **For mobile remote mode only:** a **Mac** to host the daemon, plus [Tailscale](https://tailscale.com/download) on both the Mac and the mobile device

## Installation

This fork is distributed through GitHub/BRAT, not the Obsidian Community Plugin directory.

### BRAT (recommended)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin.
2. Add the beta plugin repository `kvarnelis/claudian-praetor`.
3. Enable **Claudian Praetor** under Community plugins.

### Manual

1. Download `main.js`, `manifest.json`, `styles.css`, and `praetord.cjs` from the [latest release](https://github.com/kvarnelis/claudian-praetor/releases/latest).
2. Create `<vault>/.obsidian/plugins/claudian-praetor/` and copy all four files into it.
3. Enable **Claudian Praetor** in Obsidian.

## Setup

Open the **Claudian Praetor** settings tab and configure the providers you want. Leave the CLI path fields empty first so the plugin can auto-detect each CLI from your `PATH`; set a path manually only if auto-detection fails on a given device.

That's all desktop use needs — local runtimes talk to your vault directly. The remote daemon below is only for connecting mobile devices.

## Mobile remote mode (Praetor)

Praetor mode lets Obsidian on an iPhone or iPad drive the agents running on your Mac. The mobile UI connects over [Tailscale](https://tailscale.com/download) to a small daemon (`praetord`) hosted by the Mac, which runs the provider on your desktop and streams it to the device. **Claude, Codex, and Grok** are available remotely.

### Host the daemon on your Mac

1. Install and connect [Tailscale](https://tailscale.com/download) on the Mac.
2. In Claudian Praetor settings, open **Mobile daemon** and enable **Host mobile daemon on this Mac**.
3. Praetor detects the Mac's Tailscale IP, writes `~/.config/claudian-praetor/daemon.json`, starts `praetord`, and publishes the mobile URL/token into plugin data.

The host toggle is stored **only on that Mac** — it never syncs to your other desktop machines, so they won't accidentally start hosting.

### Connect from mobile

1. Install Claudian Praetor on Obsidian mobile via BRAT.
2. Install and connect [Tailscale](https://tailscale.com/download) on the device.
3. Let Obsidian Sync carry the daemon URL/token over from the Mac, or paste them manually under **Remote Mac daemon**.
4. Open Claudian Praetor and pick a remote-backed provider (Claude, Codex, or Grok).

## Privacy & data use

- Provider requests send your prompt, the files/images you attach, and tool outputs to whichever provider you configured.
- Agents can run shell commands and read, write, and delete files in your vault — see the safety note above.
- Settings and sessions live in your vault and local plugin storage.
- The Praetor daemon listens on the Mac's Tailscale address only when you explicitly enable hosting on that Mac. Its token lives in `~/.config/claudian-praetor/daemon.json` and is copied into plugin data solely so mobile devices can authenticate.

## Troubleshooting

**Provider CLI not found.** Clear the CLI path field so the plugin can auto-detect from `PATH`. If that fails, set the provider-specific CLI path in settings for that device.

**Tailscale not detected.** Turn Tailscale on and confirm the Mac has a `100.x.y.z` tailnet IP — the daemon won't publish a mobile URL until that address exists.

**Mobile can't reach the daemon.** Check that Tailscale is connected on both devices, the Mac is awake with the plugin loaded, and **Host mobile daemon on this Mac** is enabled. The daemon log is at `~/.config/claudian-praetor/praetord.log`.

## License & credits

MIT. Built on [Claudian](https://github.com/YishenTu/claudian) by [Yishen Tu](https://github.com/YishenTu) — please support the upstream project.
