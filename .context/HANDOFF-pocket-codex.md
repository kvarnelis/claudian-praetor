# Handoff — Pocket Codex

Written 2026-08-13 10:01 EDT on M4 Mac Studio. Branch `pocket-codex` @ `811faaad`.

This file lives in `.context/` per AGENTS.md but is **force-added to git** so it
travels between machines. `.context/` is otherwise gitignored.

---

## What this app is (owner-stated, 2026-08-13)

Pocket Codex brings a reduced Claudian experience to iPad and Android over
Tailscale. The intended division of labor:

- **Mac:** Claudian (upstream, `realclaudian`) handles desktop conversations and
  the provider framework. You log in there.
- **Pocket Codex:** passes the tunnel to the mobile device.
- Desktop conversation handling is **not** the point of this app.

Owner explicitly **kept** the desktop path. An earlier idea to strip it was
dropped — "who doesn't want to use LLMs on the desktop more?"

Auth is **CLI-level, not plugin-level**. `claude auth status` / `codex login
status` hold machine-wide keychain credentials. Claudian just spawns an
already-authenticated CLI, and so does the daemon. Nothing needs Claudian to be
loaded in order to inherit auth — it needs the Mac.

---

## Verified facts (commands run 2026-08-13, output seen)

| Claim | Evidence |
| --- | --- |
| GitHub repo renamed `claudian-praetor` → `pocket-codex` | `gh repo view`; old URL returns 301 |
| 25 tags + all releases carried over | `gh release list` |
| Repo description/homepage fixed | was "Praetor fork of YishenTu/claudian", homepage pointed at upstream; both cleared |
| Plugin identity | `manifest.json`: id `pocket-codex`, name Pocket Codex, author Kazys Varnelis |
| Providers remaining | `acp`, `claude`, `codex`, `grok` (Pi and OpenCode deleted) |
| Mobile seam untouched by this session | `git diff` on `src/remote/` = comments + error strings only; `POCKET_CODEX_PROTOCOL_VERSION = 1` unchanged from `PRAETOR_PROTOCOL_VERSION = 1` |
| Upstream Claudian cannot install on tablets | `upstream/main:manifest.json` → `"isDesktopOnly": true`, id `realclaudian` |
| Upstream uses the same settings file | `upstream/main:src/core/bootstrap/storagePaths.ts` → `.claudian/claudian-settings.json` |
| The daemon **writes** settings, not just reads | `daemon/src/headlessPlugin.ts:112` → `await storage.savePocketCodexSettings(settings)` |
| Mobile/pairing keys are **private** to Pocket Codex | `SharedStorageService.getRemoteDaemonConfig()` reads `loadPluginData()` = per-plugin `data.json`, scoped by plugin id. Claudian cannot see or clobber it. |
| The headless daemon is **not** a second full plugin | `daemon/src/headlessPlugin.ts` is 305 lines, header says "just enough plugin surface for provider", built as a Proxy that throws `PocketCodexPlugin.${prop} is not implemented`. Imports the provider layer only — no chat UI, tabs, views, or inline edit. Plus a 184-line `obsidianStub.ts` and a 139-line `nodeVaultApp.ts`. |
| Daemon gated on a setting | `src/main.ts:176` → `Platform.isDesktopApp && this.isLocalDaemonHostEnabled()` |
| Nothing running on this Mac | no `praetord`/`pocket-codexd` process, no LaunchAgent. `~/.config/claudian-praetor/` last written Jul 16. |
| No code excludes Android | gates are `Platform.isDesktopApp` / `isMobile`, correct for both. The compat shim at `src/main.ts:139` hardcodes `platform: 'ios'`, and `dev/mobile-load-harness.mjs` simulates iOS only — so Android was never in the test loop. |

### The mobile harness failure — PRE-EXISTING, not caused by this session

```
PROBE FAILURE: ProviderRegistry probe failed (create/delete conversation):
Cannot read properties of undefined (reading 'env')
FAIL: mobile (iOS) simulated load
PASS: desktop simulated load
```

Reproduced identically at `4dc7dab7` — the tip of `praetor` **before** any of
this session's work, i.e. the code already shipped as release `2026.7.17`.
Built that commit in a throwaway worktree with symlinked `node_modules` to
confirm.

**Do not conclude the app is broken from this.** The harness is a simulation of
iOS conditions, not a device. Owner reports the plugin worked in real use.
Unknown whether the harness bit-rotted or a real regression exists.

---

## Claims made this session that were NOT verified — treat as unreliable

- "85 upstream commits in three weeks." Carried from a pre-compaction summary.
  Read as "upstream moves fast," not as a measurement.
- "240 suites / 5,948 tests passing." **The test suite was never run** in this
  window.
- "Pi and OpenCode CLIs are not installed on this Mac."
- "Nothing else functionally changed." Only `src/remote/` was diffed line by
  line; the rest was reviewed at file-name level.
- "Your devices are running 2026.7.17." Inference; the vault was never inspected.

---

## Commits on `pocket-codex` (8 from this session)

```
811faaad docs: drop upstream Claudian product screenshot
125591b0 docs: point install instructions at renamed repo
9cadc064 docs: restore preview image in README   <- superseded by 811faaad
07cb30ec chore: rename Pocket Codex
34b2b081 chore: sort renamed imports
80c58f74 refactor: remove OpenCode provider
1cedbb67 refactor: remove Pi provider
95a4077f refactor: rename plugin to Claude's Codex  <- stale name, superseded
```

Pushed to `origin` (Forgejo) and `github` (both `praetor` and `pocket-codex`).

---

## Open decisions

**1. Settings ownership — owner's rule, not yet implemented.**
Owner: *"either it can read only to claudian's settings or it should have its
own set."* Three writers to one file is not acceptable.

Current state: Pocket Codex's own keys are already private (`data.json`). Only
provider/app settings are shared. So the change is small — stop writing
`.claudian/claudian-settings.json`, read it only.

Before implementing, check: **does Grok provider config live in the shared
file, and does upstream Claudian preserve unknown keys on round-trip?** If
Claudian drops keys it doesn't recognize, read-only on our side doesn't help
and Pocket Codex needs its own file outright. Owner leans toward its own file.
`AGENTS.md` already states the merge-don't-clobber rule for our side.

**2. The mobile harness `env` failure.** Pre-existing. Decide whether to chase
it or verify on a real device first.

**3. README still describes the wrong product.** It leads with "embeds coding
agents directly in Obsidian" and files mobile remote mode near the bottom. Per
the section at the top of this document, the tunnel *is* the product. Also:
**Android is not mentioned anywhere in the repo** except one comment. Owner says
it used to work.

**4. Hero image.** The old `assets/Preview.png` was upstream Claudian's product
shot — its sidebar literally read "Claudian" and "Ask Claudian anything…". It
has been deleted and unlinked. A real screenshot needs the new plugin installed,
which needs a release cut first.

**5. Release not cut.** `manifest.json` says `2026.7.18`; latest GitHub release
is `2026.7.17`. BRAT installs from **releases**, so no device sees any of this
work until a release is published. Today's CalVer would be `2026.8.13`.

**6. GitHub default branch is still named `praetor`.** `main` in this repo holds
the *upstream Claudian baseline*, not owner work — renaming `praetor` → `main`
collides and needs a decision about `main` first.

**7. Leftovers.** Three now-orphaned ACP files (`AcpSessionConfig.ts`,
`AcpToolStreamAdapter.ts`, `buildAcpUsageInfo.ts`) are unused in production but
kept because Grok still uses the rest of `src/providers/acp/`. Decide whether
the `upstream` remote stays (recommend: keep, read-only).

---

## Do not rename or migrate

These are data-compatibility contracts, not residual branding:

`.claudian/` · `claudian-settings.json` · `.claude/` · `.codex/` ·
`~/.config/claudian-praetor/` · `<vault>/.obsidian/plugins/claudian-praetor/data.json`
(first-run migration **source**) · the `_claudian` MCP metadata namespace ·
legacy localStorage keys.

Keep `LICENSE` and the Yishen Tu copyright and credits intact. Independence does
not erase Claudian's authorship.

---

## Next machine: start here

1. `git checkout pocket-codex` — note the branch was renamed from
   `claudes-codex`; the old name may still exist as a stale remote ref.
2. Run the full check before trusting anything above:
   `npm run typecheck && npm run lint && npm run test && npm run build`
   (this session never ran the test suite).
3. Pick up open decision **1** (settings ownership) — it is the one the owner
   actually specified and it is blocked only on reading upstream's settings
   round-trip behavior.
