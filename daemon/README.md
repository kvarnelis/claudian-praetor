# praetord — Claudian Praetor daemon

`praetord` hosts Claudian Praetor provider runtimes on a desktop Mac and exposes them over WebSocket for Obsidian mobile clients. The mobile UI is remote; the provider sessions, credentials, vault access, and tool execution stay on the Mac.

## Normal Setup

Use the plugin settings rather than editing JSON by hand:

1. Install and connect [Tailscale](https://tailscale.com/download) on the Mac.
2. Open Obsidian desktop → Claudian Praetor settings → **Mobile daemon**.
3. Enable **Host mobile daemon on this Mac**.
4. Praetor detects the Mac’s Tailscale `100.x.y.z` address, creates `~/.config/claudian-praetor/daemon.json` if needed, starts the bundled daemon, and publishes the mobile URL/token to plugin data for Obsidian Sync.

The host checkbox is local to that Mac. The URL/token is synced so iPhone and iPad clients can connect.

## Manual Build and Run

```bash
npm run build:daemon          # -> daemon/dist/praetord.cjs
node daemon/dist/praetord.cjs --vault /path/to/vault --host 100.x.y.z --port 8423
```

First run creates `~/.config/claudian-praetor/daemon.json` with a random auth token. Useful flags: `--vault`, `--host`, `--port`, `--config`, `--print-config`.

## Mobile Client Setup

1. Install Claudian Praetor on Obsidian mobile via BRAT from `kvarnelis/claudian-praetor`.
2. Install and connect Tailscale on the mobile device.
3. Let Obsidian Sync carry the URL/token from the Mac, or paste them in **Remote Mac daemon** settings.
4. Open Claudian Praetor and use a remote-backed provider.

## Smoke Test

```bash
node daemon/test-client.mjs --url ws://127.0.0.1:8423   --token "$(python3 -c "import json;print(json.load(open('$HOME/.config/claudian-praetor/daemon.json'))['token'])")"   --provider claude --model haiku
```

## Notes

- The daemon edits the Mac’s vault copy; Obsidian Sync propagates file changes to mobile.
- Keep the Mac awake while away: System Settings → Energy → prevent automatic sleeping on power, or use `caffeinate -i`.
- Settings live-reload from `.claudian/claudian-settings.json` as Sync updates arrive.
- Runtimes survive short mobile disconnects; orphaned runtimes are disposed after 30 minutes.
