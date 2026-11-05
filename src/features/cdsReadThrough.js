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

  function inRange(i, range) {
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
  // `oveReadThrough` is a list of ranges, since a merged translation can have
  // inferred stretches between the features it spans.
  function isReadThroughBase(annotation, sequenceIndex) {
    if (!annotation || !annotation.oveReadThrough) return false;
    const ranges = [].concat(annotation.oveReadThrough);
    for (const range of ranges) {
      if (inRange(sequenceIndex, range)) return true;
    }
    return false;
  }

  // ------------------------------------------------------- merging one ORF
  // Several CDS features can sit in a single open reading frame — a tag, a
  // linker and the gene itself, say. Translating each one separately stacks a
  // near-identical row of amino acids per feature, each reading through to the
  // same stop codon. They are one protein, so they get one translation: it
  // starts at the 5'-most feature of the frame and ends at their shared stop.
  //
  // Two features belong to the same reading frame exactly when, after reading
  // through, they terminate on the same base — getting there in steps of three
  // means their start codons are in the same frame.

  const mod = (i, len) => ((i % len) + len) % len;

  function distanceToTerminus(entry, len, isCircular) {
    return entry.forward
      ? (isCircular ? mod(entry.terminus - entry.feature.start, len) : entry.terminus - entry.feature.start)
      : (isCircular ? mod(entry.feature.end - entry.terminus, len) : entry.feature.end - entry.terminus);
  }

  // The parts of `span` not covered by any of `covered`, as absolute ranges.
  function uncovered(span, covered, len, isCircular) {
    const offsetOf = (i) => (isCircular ? mod(i - span.start, len) : i - span.start);
    const spanLen = offsetOf(span.end) + 1;
    const blocks = covered
      .map((r) => {
        const from = offsetOf(r.start);
        const length = (isCircular ? mod(r.end - r.start, len) : r.end - r.start) + 1;
        return [from, from + length - 1];
      })
      .filter(([, to]) => to >= 0)
      .map(([from, to]) => [Math.max(0, from), Math.min(spanLen - 1, to)])
      .filter(([from, to]) => from <= to)
      .sort((a, b) => a[0] - b[0]);

    const gaps = [];
    let cursor = 0;
    for (const [from, to] of blocks) {
      if (from > cursor) gaps.push([cursor, from - 1]);
      cursor = Math.max(cursor, to + 1);
    }
    if (cursor <= spanLen - 1) gaps.push([cursor, spanLen - 1]);
    const norm = (i) => (isCircular ? mod(span.start + i, len) : span.start + i);
    return gaps.map(([from, to]) => ({ start: norm(from), end: norm(to) }));
  }

  // The whole set of CDS translations for a sequence: one per reading frame,
  // not one per feature. Returns a map keyed by feature id, as the editor wants.
  function cdsTranslations(cdsFeatures, sequence, isCircular) {
    const out = {};
    const features = cdsFeatures ? [].concat(cdsFeatures) : [];
    const len = (sequence || "").length;
    if (!features.length || !len) return out;

    const entries = features.map((feature) => {
      const extended = extendCds(feature, sequence, isCircular);
      const forward =
        feature.forward !== undefined ? !!feature.forward : feature.strand !== -1;
      const start = extended ? extended.start : feature.start;
      const end = extended ? extended.end : feature.end;
      return { feature, forward, start, end, terminus: forward ? end : start };
    });

    // group by strand and shared stop codon
    const groups = new Map();
    for (const entry of entries) {
      const key = (entry.forward ? "+" : "-") + entry.terminus;
      const inFrame = distanceToTerminus(entry, len, isCircular) % 3 === 2;
      // anything whose frame doesn't line up stays on its own, so a joined or
      // malformed feature can never be folded into someone else's protein
      const groupKey = inFrame ? key : "solo:" + entry.feature.id;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(entry);
    }

    for (const group of groups.values()) {
      // reading order: the member that starts furthest upstream comes first
      group.sort(
        (a, b) =>
          distanceToTerminus(b, len, isCircular) - distanceToTerminus(a, len, isCircular)
      );
      const head = group[0];
      const span = head.forward
        ? { start: head.feature.start, end: head.terminus }
        : { start: head.terminus, end: head.feature.end };

      const annotation = Object.assign({}, head.feature, {
        start: span.start,
        end: span.end,
        forward: head.forward,
        translationType: "CDS Feature",
      });
      if (group.length > 1) {
        annotation.name = group
          .map((e) => e.feature.name)
          .filter(Boolean)
          .join(" \u2192 ");
      }
      const inferred = uncovered(
        span,
        group.map((e) => ({ start: e.feature.start, end: e.feature.end })),
        len,
        isCircular
      );
      if (inferred.length) annotation.oveReadThrough = inferred;
      out[head.feature.id] = annotation;
    }
    return out;
  }

  const api = {
    extendCds,
    cdsTranslations,
    isReadThroughBase,
    readThroughColor,
    codonAt,
    isStop,
    STOP_CODONS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) {
    root.oveCdsTranslations = (cdsFeatures, sequence, isCircular) =>
      cdsTranslations(cdsFeatures, sequence, isCircular);
    root.oveReadThroughColor = (annotation, sequenceIndex, sequenceLength) =>
      isReadThroughBase(annotation, sequenceIndex, sequenceLength) ? readThroughColor : null;
  }
})(typeof window !== "undefined" ? window : undefined);
