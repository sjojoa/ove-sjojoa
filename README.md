# ove-sjojoa

A fork of [TeselaGen's Open Vector Editor desktop app](https://github.com/TeselaGen/ove-electron)
(`ove-electron`) with the features our lab needed for routine cloning and Sanger
verification. Everything runs locally — no server, no account, no internet.

> Not affiliated with or endorsed by TeselaGen. "Open Vector Editor" is their project.
> This fork is renamed and uses its own icon (`icon.svg` / `icon.png`, drawn for this
> project) rather than TeselaGen's, to avoid confusion and any trademark infringement.
> The MIT licence covers copyright, not trademarks.

## What this fork adds

### Sanger read alignment that works offline
Upstream's alignment tool posted sequences to `j5server.teselagen.com`, which no longer
exists (the domain does not resolve), so alignment could never work. This fork replaces it
with an aligner that runs on your machine ([`src/alignment/localAligner.js`](src/alignment/localAligner.js)):

- affine-gap overlap alignment, so short reads can sit anywhere on a long reference
- both strands are tried; reverse reads are flipped along with their chromatogram
- k-mer seeding keeps long references fast (a 1 kb read against 200 kb takes <0.1 s)
- multiple-sequence, pairwise, and auto-trim modes all work

### Alignment navigation
- **◀ / ▶ mismatch arrows** that step through differences, with a description of each:
  `ref 401 · in F13557 (CDS): c.232A>G · p.Ile78Val`. Silent, nonsense, frameshift and
  in-frame indels are named, and genes on the reverse strand are handled.
- a **position slider** showing where you are in reference coordinates
- reference **features displayed in the alignment**, aligned to the bases
- clicking or selecting in the alignment **moves the Sequence Map** to the same place

### Cloning menu
Calculations in [`src/cloning/dnaTools.js`](src/cloning/dnaTools.js), UI in `cloningTools.js`.

- **Design PCR Primers** — ranked pairs with Tm, GC, product size, annealing temperatures
  for Taq and Q5/Phusion, hairpin/dimer warnings, and optional 5′ restriction sites or tags
- **Primer / Oligo Analyzer** — Tm, hairpins, self- and cross-dimers, and binding-site
  search (≤2 mismatches, 3′ end must match)
- **Site-Directed Mutagenesis** — by amino acid or by bases; Q5-style or QuikChange primers
- **Restriction Cloning** — digest, pick fragments, ligate; models sticky/blunt/Type IIS ends
  and warns about non-directional cloning and vector self-ligation
- **Gibson / HiFi Assembly** — overlap primers and the assembled construct
- **Agarose Gel Simulator** — ladders, multiple lanes, 0.7–3% gels, supercoiled/nicked forms

Melting temperatures use SantaLucia (1998) nearest-neighbour parameters with the
Owczarzy (2008) salt correction, and match Biopython's `Tm_NN` to within 0.001 °C across
200 random primers under four buffer conditions.

### Editor
- **Document tabs** — one window holds many sequences; drag a tab out to its own window,
  or drop it back onto another window's strip (right-click a tab for "Move to Window")
- **Per-feature colours** — a colour row in the Add/Edit Feature dialog, saved as a
  `/color=` qualifier so it survives a round trip through `.gb` and opens correctly elsewhere
- **File → Open Recent** — last 10 files, ⌘1–⌘9, auto-pruned
- **One CDS translation per reading frame, read through to the stop codon**
  ([`src/features/cdsReadThrough.js`](src/features/cdsReadThrough.js)). Upstream gives every
  CDS feature its own row of amino acids, so a tag + linker + gene construct stacks three
  near-identical rows. Here they are recognised as one protein and share a single row, which
  continues in frame past the last annotation to the first stop codon (wrapping the origin on
  circular sequences). Residues no feature annotates are drawn in grey, so inferred sequence is
  never mistaken for annotated coding sequence. Features that already end in a stop codon are
  not extended, and separate frames or strands stay on separate rows.
- **Inline-tagged ("rogala") text, in and out**
  ([`src/features/taggedText.js`](src/features/taggedText.js)). Opening a `.txt` whose bases
  carry `[Name]…[/Name]` tags builds a real annotated sequence — types, strands, colours,
  spliced `#1`/`#2` segments, and the lab's convention that a backslash on the *opening* tag
  (`[\AmpR]…[AmpR]`) means the reverse strand. Saving to `.txt` writes the sequence back out
  the same way, emitting only what differs from the defaults so the text stays readable in an
  email. Parsing is deliberately forgiving — hand-maintained files drift — and anything it had
  to guess or drop is shown as a warning instead of being swallowed.
- **⌘A behaves like ⌘A** — selects the text in the find box when a field has focus, and the
  whole sequence otherwise
- **⌘F always opens or re-arms the find box** — pressed again while already in it, it selects
  the current query, so pasting a new sequence replaces the old one

### Upstream bugs fixed
Most are patched at install time by [`scripts/patch-ove.js`](scripts/patch-ove.js); the two
keyboard ones are handled by this app's own Edit menu:

| Bug | Effect |
|---|---|
| `updatedData.color = getFeatureToColorMap[...]` | missing `()` — indexed the function, so saving a feature wiped its colour |
| alignment data deleted on unmount | switching tabs lost the alignment ("No Tracks Found") |
| pairwise alignment chromatograms | every read showed read #1's trace |
| `handleAlignment` result not awaited | a local aligner had to return synchronously |
| `filePath: path` in `main.js` | passed Node's `path` module instead of the file path |
| `JSON.parse` of a plain string in `preload.js` | `window.filePath` was never set, so Save never pre-filled a path |
| `onRename` called an undefined `setNewTitle` | File → Rename Sequence threw, so sequences could not be renamed |
| one translation row per CDS feature | a tag + linker + gene in one frame stacked three rows of the same protein |
| CDS translations truncated at the feature boundary | a mis-annotated CDS hid the real reading frame; now it reads through to the stop codon |
| no `selectAll` role in the Edit menu | macOS never delivered ⌘A to any text field, so the find box could not be cleared |
| Version History drawn under the tab strip | its Back button was unclickable, so opening version history stranded you with no menu bar and no way back |
| ⌘F dead once the caret is in the find box | the input swallowed the key and the editor's own hotkey never fires inside a text field, so a second ⌘F did nothing; it now selects the query so the next thing typed or pasted replaces it |

## Installing the app

Download the `.dmg` for your Mac from the
[Releases page](https://github.com/sjojoa/ove-sjojoa/releases) — `-arm64` for Apple
Silicon (M1 and later), `-intel` for older Macs. Open it and drag **OVE-sjojoa** into
Applications.

The app is not signed with an Apple Developer certificate, so the first launch is
blocked. Either:

- open it once from Finder, then go to **System Settings → Privacy & Security** and
  click **Open Anyway** next to the message about OVE-sjojoa; or
- clear the download flag from a terminal:

```bash
xattr -dr com.apple.quarantine /Applications/OVE-sjojoa.app
```

Only needed once. Nothing in the app phones home: there is no auto-update, no
telemetry, and no account.

## Building from source

Requires Node 18+ (built against Electron 22).

```bash
git clone https://github.com/sjojoa/ove-sjojoa.git
cd ove-sjojoa
yarn install   # postinstall applies scripts/patch-ove.js
yarn start
```

`node_modules` is not committed. `patch-ove.js` re-applies the upstream fixes to the
freshly downloaded `open-vector-editor` on every install; it is idempotent and only warns
(never fails) if a target string is missing, which is what you would see after bumping
`open-vector-editor` past the pinned `18.3.6`.

```bash
yarn test            # unit tests
yarn lint            # eslint
yarn build-local-mac # unsigned local .app (no Apple Developer account needed)
yarn build-dmg       # .dmg installers for both Mac architectures, into dist/installers
yarn build-mac       # signed/notarised build; needs APPLEID + APPLEIDPASS
```

## What has been tested

**Used in real work**

- **Sanger read alignment** — the reason this fork exists; run on real sequencing reads
  against real references, including reverse-strand reads and auto-trimming. The mismatch
  arrows and their `c.`/`p.` descriptions have been read off real traces.
- **Adding features and primers** — annotating sequences in the editor, including the
  per-feature colours added here, and round-tripping them through `.gb`.

**Everything else is unvalidated.** The Cloning menu (primer design, restriction cloning,
mutagenesis, Gibson assembly, the gel simulator) and the CDS read-through translations are
implemented and covered by unit tests, but those tests check that the code does what it was
designed to do — they are not validation against a wet-lab result or against another tool.
Nothing here has been used to plan a cloning experiment that was then carried out. Treat the
output as a starting point and check it before ordering oligos.

The one independent comparison: melting temperatures match Biopython's `Tm_NN`
(SantaLucia 1998 nearest-neighbour parameters with the Owczarzy 2008 salt correction) to
within 0.001 °C across 200 random primers under four buffer conditions. That validates the
Tm arithmetic, not the primer-design decisions built on top of it.

```bash
yarn test   # 63 unit tests
```

## Licence

Code written for this fork is MIT (`LICENSE`).

Upstream `ove-electron` contradicts itself: its `LICENSE.md` is a CC0 1.0 public-domain
dedication while its `package.json` declares MIT. That file is kept here unchanged as
[`LICENSE-ove-electron.md`](LICENSE-ove-electron.md) so the terms it was released under
travel with the code. CC0 waives all rights, so releasing this fork under MIT is permitted
either way.

Bundled dependencies are permissive — MIT, ISC, Apache-2.0 and BSD; there is no GPL,
LGPL or AGPL code in the tree (`jszip` is dual MIT/GPL and is used under MIT).
`open-vector-editor` and the `@teselagen/*` libraries are MIT, from
[TeselaGen/tg-oss](https://github.com/TeselaGen/tg-oss).

Upstream `TeselaGen/openVectorEditor` was archived in January 2024 and now lives in
`tg-oss`; several of the bugs above are still present in the published package.
