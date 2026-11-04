// Read-through translation for CDS features.
//
// Upstream OVE stops a CDS feature's translation at the feature's own end,
// even when the reading frame plainly continues. That hides the common case of
// a CDS whose annotated boundary is wrong, or a construct where an insert has
// shifted the real stop codon. Here the translation keeps going, in frame, past
// the end of the feature until the first stop codon (or, failing that, the end
// of the sequence — wrapping the origin when the sequence is circular).
//
// A feature that already ends in a stop codon is left alone: its annotation is
// complete, and extending it would be wrong.
//
// The extra residues are inferred rather than annotated, so they are drawn in a
// muted colour (see `readThroughColor`), which the patched Translation renderer
// in the OVE bundle asks about per amino acid.
//
// No DOM code here, so it can be unit tested in Node (test/cdsReadThrough.test.js).
(function (root) {
  const STOP_CODONS = ["TAA", "TAG", "TGA"];
  const COMPLEMENT = { A: "T", T: "A", G: "C", C: "G" };

  // colour of the inferred residues; deliberately drab next to the amino-acid
  // palette so read-through is never mistaken for annotated coding sequence
  const readThroughColor = "#c9ccd1";

  function baseAt(sequence, i, isCircular) {
    const len = sequence.length;
    if (i < 0 || i >= len) {
      if (!isCircular) return null;
      i = ((i % len) + len) % len;
    }
    return (sequence[i] || "").toUpperCase();
  }

  // the codon starting at `i` on the given strand, or null if it runs off a
  // linear sequence. On the reverse strand `i` is still the lowest index of the
  // three bases; the codon is their reverse complement.
  function codonAt(sequence, i, forward, isCircular) {
    let bases = "";
    for (let k = 0; k < 3; k++) {
      const b = baseAt(sequence, i + k, isCircular);
      if (b === null) return null;
      bases += b;
    }
    if (forward) return bases;
    let rc = "";
    for (let k = 2; k >= 0; k--) rc += COMPLEMENT[bases[k]] || "N";
    return rc;
  }

  function isStop(codon) {
    return codon !== null && STOP_CODONS.indexOf(codon) !== -1;
  }

  function inRange(i, range, len) {
    if (!range) return false;
    if (range.start <= range.end) return i >= range.start && i <= range.end;
    // origin-spanning
    return i >= range.start || i <= range.end;
  }

  // How many bases the feature covers, allowing for an origin-spanning range.
  function spanLength(feature, len) {
    return feature.start <= feature.end
      ? feature.end - feature.start + 1
      : len - feature.start + feature.end + 1;
  }

  // Returns null when nothing should change, otherwise the fields to merge into
  // the translation annotation: the widened range plus the read-through region
  // so the renderer can tell the inferred residues apart.
  function extendCds(feature, sequence, isCircular) {
    if (!feature || !sequence || !sequence.length) return null;
    // Joined/multi-segment features have their own frame bookkeeping; leave them be.
    if (feature.locations && feature.locations.length > 1) return null;
    const len = sequence.length;
    if (feature.start < 0 || feature.end < 0 || feature.start >= len || feature.end >= len) return null;
    if (!isCircular && feature.start > feature.end) return null;

    const forward = feature.forward !== undefined ? !!feature.forward : feature.strand !== -1;
    const covered = spanLength(feature, len);
    if (covered < 3) return null;

    // Index of the first base of each codon, counting from the feature's start
    // codon: forward codons run start, start+3, …; reverse ones end, end-3, …
    const codonStart = (k) =>
      forward ? feature.start + 3 * k : feature.end - 3 * k - 2;

    // Does the feature already finish on a stop codon, exactly at its boundary?
    if (covered % 3 === 0) {
      const lastK = covered / 3 - 1;
      if (isStop(codonAt(sequence, codonStart(lastK), forward, isCircular))) return null;
    }

    // Walk on in frame. One full turn of the sequence is the hard stop, so a
    // circular sequence with no stop codon in frame cannot loop forever.
    const firstNewK = Math.floor(covered / 3);
    const maxK = firstNewK + Math.ceil(len / 3);
    for (let k = firstNewK; k <= maxK; k++) {
      const i = codonStart(k);
      const codon = codonAt(sequence, i, forward, isCircular);
      if (codon === null) break; // ran off the end of a linear sequence
      if (isStop(codon)) {
        // include the stop codon itself, so the terminator is visible
        const lastBase = forward ? i + 2 : i;
        return result(feature, lastBase, forward, len, isCircular);
      }
    }

    // No stop codon found: run to the end of a linear sequence, or give up on a
    // circular one rather than drawing a translation that laps the whole plasmid.
    if (isCircular) return null;
    const lastBase = forward ? len - 1 : 0;
    // only extend if there is at least one more whole codon to show
    const gained = forward ? lastBase - (feature.end) : feature.start - lastBase;
    if (gained < 3) return null;
    return result(feature, lastBase, forward, len, isCircular);
  }

  function result(feature, lastBase, forward, len, isCircular) {
    const norm = (i) => (isCircular ? ((i % len) + len) % len : i);
    const newEnd = forward ? norm(lastBase) : feature.end;
    const newStart = forward ? feature.start : norm(lastBase);
    const readThrough = forward
      ? { start: norm(feature.end + 1), end: newEnd }
      : { start: newStart, end: norm(feature.start - 1) };
    if (forward ? newEnd === feature.end : newStart === feature.start) return null;
    return { start: newStart, end: newEnd, oveReadThrough: readThrough };
  }

  // Asked once per rendered amino acid by the patched Translation renderer.
  function isReadThroughBase(annotation, sequenceIndex, sequenceLength) {
    if (!annotation || !annotation.oveReadThrough) return false;
    return inRange(sequenceIndex, annotation.oveReadThrough, sequenceLength);
  }

  const api = { extendCds, isReadThroughBase, readThroughColor, codonAt, isStop, STOP_CODONS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) {
    root.oveCdsReadThrough = (feature, sequence, isCircular) =>
      extendCds(feature, sequence, isCircular);
    root.oveReadThroughColor = (annotation, sequenceIndex, sequenceLength) =>
      isReadThroughBase(annotation, sequenceIndex, sequenceLength) ? readThroughColor : null;
  }
})(typeof window !== "undefined" ? window : undefined);
