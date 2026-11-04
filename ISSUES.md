# Known issues / to file on GitHub

Tracked here until the repository is published; each entry is written so it can be
pasted into a GitHub issue as-is. Fixed items move to CHANGELOG.md and are removed.

---

## 1. CDS features should show the read-through translation up to the next stop codon

**Current behaviour.** The translation shown for a feature annotated as a CDS stops at
the end of the feature, even when the reading frame continues past it.

**Expected behaviour.** When a CDS feature does *not* end in a stop codon, keep
translating in the same frame past the feature's end and display those residues too,
stopping at the first in-frame stop codon (or the end of the sequence, and wrapping the
origin for circular sequences). When the feature *does* already end in a stop codon,
behave exactly as today and show nothing beyond it.

**Why it matters.** Truncated or mis-annotated CDS boundaries are common in constructs
assembled from fragments; seeing the read-through immediately shows whether the real
ORF extends further than the annotation claims, and where it actually terminates.

**Notes.** The extra residues are inferred, not annotated, so they should be visually
distinguishable from the annotated part of the translation (e.g. dimmed or hatched)
rather than drawn identically.

---

## 2. Cmd+A does not select the text inside the search box

**Current behaviour.** With the cursor in the sequence search field, ⌘A (Ctrl+A on
Windows/Linux) selects the whole *sequence* instead of the text in the field, so the
existing search term cannot be selected and replaced in one go; it has to be deleted
character by character.

**Expected behaviour.** While focus is inside a text input or textarea, ⌘A selects that
field's contents, as in every other text field. The sequence-wide Select All applies
only when focus is in the editor itself.

**Cause.** `selectAll` in `node_modules/open-vector-editor/lib/commands/index.js` binds
the global hotkey `mod+a` and calls `event.preventDefault()` / `stopPropagation()`
whenever it fires via hotkey, with no check of `event.target`. The comment just below
the binding shows the author was already aware that hotkey props here "will block
inputs".

**Suggested fix.** In that handler, return early (without preventing the default) when
`event.target` is an `<input>`, `<textarea>`, or an element with `contenteditable`.
Applies as a patch in `scripts/patch-ove.js`, and is worth sending upstream.
