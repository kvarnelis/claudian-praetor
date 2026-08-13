# pocket-codexd — Pocket Codex daemon

`pocket-codexd` hosts Pocket Codex provider runtimes on a desktop Mac and exposes them over WebSocket for Obsidian mobile clients. The mobile UI is remote; the provider sessions, credentials, vault access, and tool execution stay on the Mac.

## Normal Setup

Use the plugin settings rather than editing JSON by hand:

1. Install and connect [Tailscale](https://tailscale.com/download) on the Mac.
2. Open Obsidian desktop → Pocket Codex settings → **Mobile daemon**.
3. Enable **Host mobile daemon on this Mac**.
4. Pocket Codex detects the Mac’s Tailscale `100.x.y.z` address, creates `~/.config/claudian-praetor/daemon.json` if needed, starts the bundled daemon, and publishes the mobile URL to plugin data for Obsidian Sync.
5. Click **Pair iPhone or iPad** when adding a mobile device. Pairing stays open for five minutes.

The host checkbox and paired-device list are local to that Mac. Only the URL is synced so iPhone and iPad clients can find the daemon.

## Manual Build and Run

```bash
npm run build:daemon          # -> daemon/dist/pocket-codexd.cjs
node daemon/dist/pocket-codexd.cjs --vault /path/to/vault --host 100.x.y.z --port 8423
```

First run creates `~/.config/claudian-praetor/daemon.json` with the daemon host, vault path, and paired clients. Useful flags: `--vault`, `--host`, `--port`, `--config`, `--print-config`.

## Mobile Client Setup

1. Install Pocket Codex on Obsidian mobile via BRAT from `kvarnelis/pocket-codex`.
2. Install and connect Tailscale on the mobile device, signed into the same tailnet as the Mac.
3. Let Obsidian Sync carry the URL from the Mac, or paste it in **Remote Mac daemon** settings.
4. Open pairing from the Mac settings, then open Pocket Codex on mobile to pair the device.
5. Use a remote-backed provider.

## Smoke Test

Open pairing from the desktop plugin first; loopback is trusted for local smoke tests, so the client will pair as `test-client` on first connection.

```bash
node daemon/test-client.mjs --url ws://127.0.0.1:8423 --provider claude --model haiku
```

## Notes

- The daemon edits the Mac’s vault copy; Obsidian Sync propagates file changes to mobile.
- Keep the Mac awake while away: System Settings → Energy → prevent automatic sleeping on power, or use `caffeinate -i`.
- Settings live-reload from `.claudian/claudian-settings.json` as Sync updates arrive.
- Runtimes survive short mobile disconnects; orphaned runtimes are disposed after 30 minutes.

## Persistent LaunchAgent Deployments

The desktop plugin normally runs the bundled daemon from
`<vault>/.obsidian/plugins/pocket-codex/pocket-codexd.cjs`. A legacy
LaunchAgent may instead run the compatibility path
`~/.config/claudian-praetor/praetord.cjs` with `KeepAlive` enabled.

That managed copy must be updated whenever the plugin's daemon protocol changes.
Otherwise it can continuously restart an obsolete daemon, claim port `8423`, and
make the current mobile client report misleading authentication errors. Updating
only the Obsidian plugin is not sufficient for this deployment.

To diagnose the active daemon on macOS:

```bash
lsof -nP -iTCP:8423 -sTCP:LISTEN
pgrep -afil 'pocket-codexd|praetord'
```

If the process command points at `~/.config/claudian-praetor/praetord.cjs`, copy
the release's current `pocket-codexd.cjs` to that compatibility filename and
restart `com.claudian.praetord`. After a token-to-pairing migration,
`~/.config/claudian-praetor/daemon.json` should contain `pairedClients` and must
not contain `token`.

## TODO

- Add a versioned daemon handshake to the desktop supervisor. Do not treat an
  occupied port as proof that a compatible daemon is running.
- Add an install/update command for persistent LaunchAgent deployments that
  atomically updates the managed `pocket-codexd.cjs` before restarting the service.
- Report protocol incompatibility explicitly on mobile instead of surfacing it
  as an authentication failure.
