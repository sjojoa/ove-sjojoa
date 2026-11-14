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
- **One File menu, in both places**
  ([`src/features/fileMenu.js`](src/features/fileMenu.js)) — New File, Open…, Open Recent
  and Reopen Last Closed Window are in the editor window's own File menu as well as the
  system menu bar, so the menu next to the sequence can open a file. Same actions, same
  recent list, same shortcuts (shown as hints; the system menu still owns the keys).
- **Version history, kept inside the sequence file**
  ([`src/main_utils/history.js`](src/main_utils/history.js)) — every save of a `.gb`
  records what was written, so the toolbar's Version History view lists the earlier
  versions of a construct, previews any of them and can revert to one. The history rides
  in the file as a single compressed comment, which means it travels with the plasmid:
  copy the file to a shared drive or hand it to someone else and its record goes too,
  instead of staying behind in this Mac's application-support folder. A version costs
  about 4 KB for a 7 kb plasmid, the last 25 are kept, an unchanged save does not add
  one, and Save As carries the history to the new file so a renamed construct keeps its
  lineage. **File → Version History** trims to the last 10, 5 or 1, or deletes the lot,
  when a file has grown further than it is worth.
- **The files you had open come back next launch**
  ([`src/main_utils/session.js`](src/main_utils/session.js)) — close the app with the
  vector, the insert and the donor on one strip and they are there again, in the same
  order, with the same tab in front. Several windows come back as several windows. Opening
  a `.gb` by double-clicking it adds that file to them and brings it to the front, rather
  than replacing them — asking for one sequence is not a request to throw away the four you
  had — and a file that is already open is brought forward instead of opened twice. Close
  every tab before quitting and nothing is restored: that was a deliberate clear-out. Files
  that moved or were deleted in the meantime are skipped without a word, and a sequence
  that was never saved is not restored — there is no file to restore it from. **File → Reopen Last Closed
  Window** (⇧⌘T) undoes a misclick on a window's close button, up to ten deep, for the
  session you are in.
- **Unsaved changes are not thrown away silently**
  ([`src/tabs/unsaved.js`](src/tabs/unsaved.js)) — a tab with unsaved work shows a filled
  dot where its close button is, so you can see which of six tabs still needs saving before
  clicking anything; hovering turns the dot back into a ×. Closing such a tab, its window,
  or the app asks **Save / Save As / Cancel / Don't Save**, one tab at a time, and Cancel
  anywhere stops the whole thing. Save overwrites the file the tab came from; Save As asks
  where to put it, which is how to rename it or move it, and the tab then belongs to the
  new file. Cancelling the save dialog cancels the close too. An edit that has been undone
  back to the file's own content does not count as unsaved: the check compares what would
  be written against what was last read or written, not just whether anything happened. A tab that
  matches its file closes without ceremony, and moving a tab between windows is not a
  close, so it never asks. A sequence that has never been written anywhere — a PCR
  product, an assembly, a digest fragment straight out of the Cloning menu — counts as
  unsaved from the moment it holds bases, because there is no file to recover it from.
- **Backspace on a selected annotation deletes the annotation**
  ([`src/features/deleteAnnotation.js`](src/features/deleteAnnotation.js)) — click a
  feature, part or primer and press Backspace or Delete and it is removed, undoably.
  Upstream deleted the *bases* underneath instead. A selection you dragged out yourself
  still deletes bases, as does a selection nudged off the annotation after clicking it.
- **One CDS translation per reading frame, read through to the stop codon**
  ([`src/features/cdsReadThrough.js`](src/features/cdsReadThrough.js)). Upstream gives every
  CDS feature its own row of amino acids, so a tag + linker + gene construct stacks three
  near-identical rows. Here they are recognised as one protein and share a single row, which
  continues in frame past the last annotation to the first stop codon (wrapping the origin on
  circular sequences). Residues no feature annotates are drawn in grey, so inferred sequence is
  never mistaken for annotated coding sequence. Features that already end in a stop codon are
  not extended, and separate frames or strands stay on separate rows.
- **One primer hybridisation view, everywhere a primer is entered**
  ([`src/features/primerHybridization.js`](src/features/primerHybridization.js),
  [`primerView.js`](src/features/primerView.js)) — the primer's own bases are the control:
  type onto the 3′ end or trim the 5′ end and the binding sites, the per-base pairing and
  the Tm all follow. Three states are kept apart on purpose — paired, mispaired (red, with
  the template base it sits over), and 5′ tail (amber) — because a restriction site or a
  Gibson overlap is not a mismatch. An alignment of the primer against the template shows
  which stretch anneals and which hangs off, with the template drawn under the tail as well,
  reading 3′→5′ left to right (a bottom-strand primer reads right-to-left on the map, and
  the view says so). Every site is listed, best first, with its annealing length, mismatch
  count and Tm; clicking one shows it, and **Go to** selects it in the editor. **Reverse
  complement** flips the entered sequence. The same view appears in the **Primer / Oligo
  Analyzer**, in **Simulate PCR**'s two primer slots (where it picks the site the product
  comes off and feeds it to the tool), and in the **Add/Edit Primer** dialog, where it is how
  the primer is positioned at all: *Bind Start* and *Bind End* are gone, the bases are the
  primer, and the annotation follows the site computed from them. Type a base, paste a
  different oligo, hit *Reverse complement*, or pick another row in the site list, and the
  primer moves to where those bases actually bind — strand included. *Strand* reads out
  which way the computed site runs, and doubles as a second reverse-complement control:
  flip it by hand and the bases are replaced by their reverse complement, which is the
  primer binding the other strand of the same place. When they bind
  nowhere the annotation is left where it was and the panel says so, naming the stretch
  that does pair if the reason is an unpaired 3′ end.
- **Hybridisation parameters you can see and change** — which sites are reported is set by
  *N bases at the 3′ end must pair* (the end a polymerase extends from), *allow a single
  isolated mismatch* (one mismatch, 5′ of that, with pairing bases either side — adjacent
  mismatches destabilise a duplex far more than separated ones), a *minimum Tm of the paired
  stretch*, and optionally *also show sites that pair at the 5′ end only* (no product comes
  off those). Per sequence, from a default set that newly opened files start with. This
  replaced a whole-oligo alignment with a flat two-mismatch budget, which rejected every
  primer carrying a 5′ tail — exactly the primers this fork exists for.
- **Tm and GC of the selection, in the status bar and the hover title**
  ([`selectionStats.js`](src/features/selectionStats.js)) — select a primer-sized stretch
  and the status bar reads `Selecting 20 bps from 151 to 170 · Tm 58.3 °C · 45% GC`, so a
  candidate primer can be judged without opening a tool. The Tm is this fork's own
  (SantaLucia 1998 nearest-neighbour with the Owczarzy 2008 salt correction), not
  upstream's, which reads about 5 °C higher and would have disagreed with every number the
  Cloning menu prints. **Tm conditions** in the status bar states the model and the primer
  and salt concentrations behind it. Above 40 bp the line carries GC alone: a
  nearest-neighbour Tm of a kilobase is not a quantity to act on. Both View-menu toggles
  still work and both default on.
- **Simulate PCR takes a pasted primer**
  ([`pastedPrimers.js`](src/features/pastedPrimers.js)) — upstream only let you pick primers
  that were already annotations, so checking "what does this amplify?" meant creating two
  annotations first and leaving them behind. Paste the bases instead: the primer is placed
  on the template (both strands, 5′ tail and all), the product is assembled with the tail in
  it, and the pair's annealing temperatures are reported. It says plainly when a primer does
  not bind, and when one was pasted into the wrong box. Saving the primer as an annotation
  afterwards is a button, not automatic.
- **Mismatch-tolerant find** ([`src/features/mismatchSearch.js`](src/features/mismatchSearch.js))
  — the find bar gains an **Exact / ≤ 1 … ≤ 5 mismatches** control (in the wrench popover,
  or in the expanded bar). Hits come back best-first, so an exact match is never buried
  under approximate ones, and the bases that actually differ are marked on top of the hit
  rather than the whole hit being highlighted uniformly. The active match is spelled out
  next to the counter — `2 mismatches: 310 T>A, 315 C>G` — and the same text is the hit's
  hover title. Both strands, ambiguity codes honoured in Ambiguous mode, origin-wrapping
  hits on circular sequences. A 50 kb sequence against a 20-mer at ≤ 2 mismatches takes
  about 9 ms.
- **File → Import Sequence takes a paste, not only a file**
  ([`src/features/importSequence.js`](src/features/importSequence.js)). A sequence usually
  arrives in an email or an order confirmation, so the dialog leads with a paste box that
  accepts plain bases (line numbers and whitespace ignored), FASTA, GenBank and tagged text,
  with **Choose File…** still there. It says what it understood — `Genbank · 1,200 bp ·
  circular · 3 annotations` — before you accept it, so a half-copied sequence is caught at
  the point of paste. Prose is refused rather than imported as the letters it happens to
  contain. The import opens in a new tab, and a name field and circular/linear toggle cover
  what a bare paste cannot carry.
- **Inline-tagged ("rogala") text, in and out**
  ([`src/features/taggedText.js`](src/features/taggedText.js)). Opening a `.txt` whose bases
  carry `[Name]…[/Name]` tags builds a real annotated sequence — types, strands, colours,
  spliced `#1`/`#2` segments, and the lab's convention that a backslash on the *opening* tag
  (`[\AmpR]…[AmpR]`) means the reverse strand. Saving to `.txt` writes the sequence back out
  the same way — **File → Export Sequence → Download Tagged Text File**, saving to `.txt`, or
  right-clicking a selection, feature, part or primer and choosing **Copy as Tagged Text**,
  which copies just that region with the features inside it (following the editor's own Copy Options for partial
  features, and renumbering nothing, because the format's coordinates are implicit).
  Only what differs from the defaults is written, so the text stays readable in an email. Parsing is deliberately forgiving — hand-maintained files drift — and anything it had
  to guess or drop is shown as a warning instead of being swallowed.
- **"Rotate To Caret Position" is called "Set Origin"**
  ([`src/features/menuLabels.js`](src/features/menuLabels.js)) — in the Edit menu and in the
  caret's right-click menu. Same command, same ⌘B; it is what everyone calls it when looking
  at a plasmid map.
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
| Simulate PCR only accepted existing primer annotations | no way to check what a primer pair in an email amplifies without annotating it first |
| find tool matched exactly only | no way to find a primer designed against a slightly different template, or a motif that varies by a base |
| Import Sequence went straight to a file picker | no way to get a sequence in from the clipboard |
| ⌘F dead once the caret is in the find box | the input swallowed the key and the editor's own hotkey never fires inside a text field, so a second ⌘F did nothing; it now selects the query so the next thing typed or pasted replaces it |
| Primer/Oligo Analyzer aligned the whole oligo with a 2-mismatch budget | every primer with a 5′ tail — Gibson overlaps, restriction sites, tagged primers — reported zero binding sites; now the 3′ end anchors the site and the tail is reported as a tail |
| GC content and Tm of a selection both shipped switched off | two settings nobody finds, so the commonest question about a selection — is this a usable primer? — meant opening a tool |
| status bar Tm disagreed with the Cloning menu's by ~5 °C | the same bases got two different melting temperatures depending on where you looked; the status bar now uses the fork's model (`calculateNebTm` also returned `NaN` as the component called it) |
| main window opened at a fixed 1000x800 | smaller than the app's own Add/Edit Primer dialog, which then scrolled from the moment it opened; it now opens at the size of the display, and the annotation dialogs are 580px wide so an alignment fits in one |
| primer bases and binding coordinates were independent fields | adding a base left the annotation behind, and the dialog then marked most of the oligo red against a stretch of template it was never meant to sit on; the coordinates are now computed from the bases |
| the primer dialog printed its own melting temperature | ~6 °C from the one the hybridisation view and the Cloning menu report, on the same bases, a few pixels apart |
| no per-base view of how a primer pairs | the Add/Edit Primer dialog showed bases and coordinates but never whether they pair where they claim to |
| Backspace on a clicked feature deleted the sequence under it | clicking an annotation selects its bases, and the key binding saw only the selection, so the obvious way to remove a feature silently cut bases out of the construct; it now deletes the annotation when the selection is still exactly that annotation's range |
| File → Save and Save As threw before reaching the dialog | the handler took a `doc` parameter that shadowed the tab in scope and was never passed one, so every save failed with `Cannot read properties of undefined (reading 'filePath')` — nothing in this fork could be saved from the File menu or the toolbar |
| Save asked where to put the file every time | even for a sequence opened from a file a moment earlier, so saving a construct repeatedly meant re-confirming the same path; Save now overwrites the file the tab came from and Save As is the one that asks |
| Save As left the tab editing the old file | renaming a construct through Save As wrote the copy and then quietly went on overwriting its previous name on the next Save; the tab now belongs to the file it was last written to |
| closing a tab or window discarded unsaved work without a word | no dirty flag existed anywhere, and a sequence built in the Cloning tools lives only in its tab; closing now asks, and the tab strip shows which tabs are unsaved |
| nothing was remembered about what was open | `electron-window-state` restored the window's geometry but not its contents, so a cloning session of four files had to be rebuilt by hand through Open Recent every morning |
| the editor window's File menu could not open a file | it held only the items that act on the sequence in front of you; opening anything else meant going up to the system menu bar, which on a large display is a long way from where you are working |
| the editor menu was computed once and cached forever | `getFilteredMenu` memoizes on the identity of the filter function, so a menu whose contents change while the app runs could never show them — and handing over a new function does not help, since `menuFilter` is a creation-time prop `updateEditor` ignores |
| switching tabs dropped you back at base 1 | only the tab in front has a live editor -- two of them fight over the single shared redux store -- so the one you leave is torn down, taking the row view's scroll position with it; each tab now remembers how far through its sequence it was |
| a primer created without a selection began with one stray base | the Bases field is seeded from the stretch of template the annotation covers, and with no selection that range is the caret — a single character, adopted by the form as the primer's real value, which had to be deleted before the oligo could be typed |
| you could not see which way a primer pointed | primers drawn with their bases were given an arrowhead a fifth of a character wide, which at any normal zoom reads as a bevel rather than a point — the one thing a primer has to say at a glance |
| an arrowhead could be longer than the annotation it points from | `arrowPointiness` scales the head without any cap, so a value above 1 puts the back of the arrow in front of its tip and draws a bowtie; nothing upstream passed one, so nothing upstream hit it |
| Version History listed only the current version | the view and its Restore button are complete upstream, but nothing was passed to `getVersionList` / `getSequenceAtVersion`, so the panel opened on a table of one row |
| a cancelled save still marked the sequence saved | OVE stamps its `lastSavedId` from a `.then()` that runs whether or not a file was written, so the save icon went quiet after you cancelled the dialog; the unsaved-changes guard keeps its own record per tab |

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
- **The primer features** — the hybridisation view, the binding-site search and its
  parameters, the pasted-primer path into Simulate PCR, and the rebuilt Add/Edit Primer
  dialog (bases drive the annotation; the Strand radio reverse-complements) have been
  exercised against real plasmids and behave as described above: the sites they report
  are the sites those oligos pair at, strand and 5′ tails included. **Which Tm this app reports is now
  settled** (issue #12): SantaLucia (1998) nearest-neighbour with the Owczarzy (2008)
  Mg²⁺/dNTP correction, at 50 mM Na⁺, 1.5 mM Mg²⁺, 0.8 mM dNTPs and 250 nM primer,
  checked against Biopython (below). Measured against NEB's own calculator on the same
  oligos, it sits about 1–1.5 °C below their Phusion figure and 4–5 °C below their Q5
  figure — the gap to Q5 is expected, since NEB use a monovalent-only salt correction
  there. NEB's own advice for a third-party Tm used with Q5 is to anneal at Tm + 3.
  Those conditions are not yet stated in the UI (issue #27).

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
yarn test   # 260 unit tests
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
