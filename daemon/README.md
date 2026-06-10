# praetord — the Claudian Praetor daemon

Hosts Claudian's real provider runtimes (Claude Code, Codex, Grok) on your
Mac against a vault directory, and serves them over WebSocket so Claudian
Praetor on a mobile device can drive them. Your subscription logins are used
exactly as on desktop — the same SDK/CLI sessions run on the same machine;
only the UI is remote.

## Build

```bash
npm run build:daemon          # → daemon/dist/praetord.cjs
```

## First run

```bash
node daemon/dist/praetord.cjs --vault /Users/kazys/netlab.obsidian
```

First run creates `~/.config/claudian-praetor/daemon.json` with a random
auth token and prints the connection details. Defaults: host `127.0.0.1`,
port `8423`. For Tailscale access, set `host` in the config to your Mac's
tailnet IP (`100.x.y.z`, shown by the Tailscale menu) or `0.0.0.0`, then
restart. The token is the auth layer; the tailnet is the network perimeter.

Useful flags: `--vault`, `--host`, `--port`, `--config`, `--print-config`.

## Plugin-side setup (iPad)

1. Install Claudian Praetor on Obsidian mobile via BRAT from
   `kvarnelis/claudian-praetor`.
2. Add to `.claudian/claudian-settings.json` (on ANY synced device — easiest
   on the Mac; Obsidian Sync carries it to the iPad):

```json
"remoteDaemon": {
  "url": "ws://<mac-tailnet-ip>:8423",
  "token": "<token from ~/.config/claudian-praetor/daemon.json>"
}
```

3. iPad: Tailscale VPN on → open Obsidian → Claudian Praetor chat.

## Smoke test

```bash
node daemon/test-client.mjs --url ws://127.0.0.1:8423 \
  --token "$(python3 -c "import json;print(json.load(open('$HOME/.config/claudian-praetor/daemon.json'))['token'])")" \
  --provider claude --model haiku
```

## Run at login (launchd)

Save as `~/Library/LaunchAgents/com.kazys.praetord.plist`, adjust paths,
then `launchctl load ~/Library/LaunchAgents/com.kazys.praetord.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.kazys.praetord</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/kazys/Developer/ai-ios-editor/claudian/daemon/dist/praetord.cjs</string>
    <string>--vault</string>
    <string>/Users/kazys/netlab.obsidian</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/kazys/Library/Logs/praetord.log</string>
  <key>StandardErrorPath</key><string>/Users/kazys/Library/Logs/praetord.log</string>
</dict>
</plist>
```

Keep the Mac awake while away: System Settings → Energy → prevent automatic
sleeping on power, or `caffeinate -i`.

## Notes

- The daemon edits the Mac's vault copy; Obsidian Sync propagates to mobile.
  Keep desktop Obsidian running if you rely on Sync.
- Settings live-reload: the daemon watches `.claudian/claudian-settings.json`,
  so model/provider settings changed from any synced device apply within
  seconds (Obsidian Sync latency + 500 ms).
- Runtimes survive client disconnects (screen lock, network blips): the
  client replays missed stream events on reconnect. Orphaned runtimes are
  disposed after 30 minutes.
