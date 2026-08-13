# Migrating from Claudian Praetor to Praetor

Praetor has the new Obsidian plugin id `praetor`. Obsidian therefore installs
it as a separate plugin in `<vault>/.obsidian/plugins/praetor/`; it does not
upgrade the old `<vault>/.obsidian/plugins/claudian-praetor/` folder in place.

## Install

1. In BRAT, remove the existing Claudian Praetor beta-plugin entry.
2. Add `kvarnelis/claudian-praetor` again. The repository name is unchanged,
   but its manifest now installs **Praetor** under the `praetor` plugin id.
3. Confirm `<vault>/.obsidian/plugins/praetor/` exists.
4. Disable the old **Claudian Praetor** plugin.
5. Enable **Praetor**. Do not run both plugins at the same time.

For a manual installation, place the release files in
`<vault>/.obsidian/plugins/praetor/`, then follow steps 4 and 5.

## What carries over automatically

- Praetor continues reading `.claudian/`, `.claude/`, `.codex/`, and the other
  existing provider-native paths in place. Vault settings, session metadata,
  commands, skills, and provider history are not relocated.
- On its first load, if Praetor has no saved plugin data and
  `<vault>/.obsidian/plugins/claudian-praetor/data.json` exists, Praetor reads
  that JSON object and saves a copy as its own plugin data. Every key in the old
  file is adopted, including daemon URL, paired-device, provider-configuration,
  host-toggle, and tab-state data when those keys are present.
- The old plugin folder and old `data.json` remain untouched.

The import runs only while Praetor's own saved data is absent or empty. If
Praetor was already opened and configured before the old file became available,
copy the old `data.json` to `<vault>/.obsidian/plugins/praetor/data.json` while
Obsidian is closed, or reinstall Praetor before the first launch.

## What does not carry over automatically

- Obsidian's enabled-plugin entry, because `praetor` is a new plugin id.
- BRAT's old installation record; re-add the repository as described above.
- Hotkeys assigned to commands under the old plugin id. Reassign any custom
  Praetor hotkeys in Obsidian's Hotkeys settings.

## Roll back

1. Disable **Praetor**.
2. Re-enable **Claudian Praetor** from the old plugin folder.

Rollback does not require restoring data. Praetor copies plugin data and reads
the shared compatibility paths in place; it does not delete or move the old
plugin's files.
