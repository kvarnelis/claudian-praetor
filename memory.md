# Claudian Praetor Project Memory

This file records decisions and operational facts that must survive individual chat sessions. Update it in the same commit whenever one of these decisions changes.

## Distribution and live verification

- The development repository is `/Users/kazys/Developer/claudian-praetor` on branch `praetor`.
- The Mac test installation is `/Users/kazys/netlab.obsidian/.obsidian/plugins/claudian-praetor/`. Copying `main.js`, `styles.css`, or `manifest.json` there proves only the Mac-side installation.
- The iPad receives Claudian Praetor through BRAT from GitHub repository `kvarnelis/claudian-praetor`. A local Mac build does not update the iPad.
- BRAT is configured in the vault at `.obsidian/plugins/obsidian42-brat/data.json`. The active plugin ID is `claudian-praetor`.
- `.obsidian/plugins/realclaudian/` is a separate upstream Claudian installation and is not the Praetor build.
- Never call an iPad change installed or finished merely because the Mac bundle hashes match. The change must be committed, tagged, released with the required assets, installed by BRAT on the iPad, and visibly checked in the iPad UI.

## Release checklist

1. Confirm the intended source diff and run `git diff --check`.
2. Run typecheck, lint, the full test suite, and the production build.
3. Bump the same calendar version in `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`.
4. Validate the tag with `node scripts/check-release-version.mjs <version>`.
5. Commit the source, tests, version files, and this memory update together.
6. Create an annotated tag matching the version, then push the `praetor` branch and tag.
7. Wait for the GitHub release workflow to publish `main.js`, `manifest.json`, `styles.css`, and `praetord.cjs` successfully.
8. On the iPad, run BRAT's beta-plugin update, reload Claudian Praetor, confirm the displayed version, and inspect the actual interaction before declaring success.

## Mobile tab and composer UX

- Numbered conversation tabs are selection controls only. Do not put a close target or long-press close gesture inside them.
- Mobile tab targets are 44 by 44 pixels. The active tab is indicated by styling, not by changing its meaning.
- Closing the active conversation uses a separate close-current-tab button at the far right of the navigation actions.
- `Control-Tab` selects the next conversation and `Control-Shift-Tab` selects the previous one, wrapping at the ends. Do not override `Command-Left` or `Command-Right`; they retain normal text-navigation behavior.
- On mobile, Obsidian's view selector is the only visible Claudian heading. Hide Claudian's repeated internal header.
- The attachment control should look like a small paperclip, while retaining a transparent 44 by 44 pixel touch target.

## Appearance

- Theme-native appearance is optional, not the default.
- In theme-native mode, preserve the host theme's typography and colors. Claudian's user prompt keeps only right alignment, a thin right rule, and heading-level emphasis.
