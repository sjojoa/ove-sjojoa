# Snapshot: the app as it stood on 2026-09-23

Recovered from `OpenVectorEditor_2026-09-23.zip`, a backup of the built
`OpenVectorEditor.app` taken before this repository existed. The repository's
first commit is 2026-11-04, so this code was in no commit, tag or release; it
was extracted from the app bundle's `app.asar` so that the backup zips could be
deleted without losing it.

`package.json` says 1.5.5. `node_modules` is deliberately not committed: this
build already applied its upstream fixes through `scripts/patch-ove.js` (five of
them) against the same pinned `open-vector-editor@18.3.6`, so the tree is
reproducible with `yarn install`.

This branch is history only. Nothing on it is meant to be built on or merged.
