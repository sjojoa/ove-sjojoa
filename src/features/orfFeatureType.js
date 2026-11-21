// A feature made from a selected ORF should come up as a CDS.
//
// OVE opens the Add Feature dialog on "misc_feature" whatever you selected, so
// annotating an ORF -- the commonest reason to draw a feature on a plasmid --
// meant changing the type by hand every time, and forgetting to meant a
// coding sequence written to the file as misc_feature.
//
// The selection is judged on its own bases rather than on OVE's ORF list:
// that list is computed by a selector only while ORFs are on screen, and the
// copy hanging off sequenceData is empty. Bases are always there, and "starts
// with a start codon, ends with a stop, nothing in between, a whole number of
// codons" is what makes a selection an ORF in the first place.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveOrfFeatureType = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STOPS = ["TAA", "TAG", "TGA"];
  // ATG plus the two OVE offers under "use GTG and CTG as start codons": a
  // selection that starts at one of those and reads cleanly to a stop is a
  // CDS whether or not that option happens to be on.
  const STARTS = ["ATG", "GTG", "CTG", "TTG"];
  const COMP = { A: "T", T: "A", G: "C", C: "G" };

  const revcomp = (s) =>
    s.split("").reverse().map((c) => COMP[c] || c).join("");

  // The bases a selection covers, reading the way the feature will.
  function basesOf({ sequence, start, end, forward = true, circular = false }) {
    const seq = String(sequence || "").toUpperCase();
    const n = seq.length;
    if (!n || !(start >= 0) || !(end >= 0)) return "";
    let out;
    if (end >= start) out = seq.slice(start, end + 1);
    else if (circular) out = seq.slice(start) + seq.slice(0, end + 1); // across the origin
    else return "";
    return forward === false ? revcomp(out) : out;
  }

  function looksLikeOrf(basesIn) {
    const bases = String(basesIn || "").toUpperCase();
    if (bases.length < 6 || bases.length % 3) return false;
    if (!STARTS.includes(bases.slice(0, 3))) return false;
    if (!STOPS.includes(bases.slice(-3))) return false;
    for (let i = 3; i < bases.length - 3; i += 3) {
      if (STOPS.includes(bases.slice(i, i + 3))) return false; // a stop inside is not one ORF
    }
    return true;
  }

  // Which reading frame a range sits in, 1..3 on the top strand and -1..-3 on
  // the bottom, counted the way OVE numbers its translation rows.
  function frameOf({ start, end, forward = true, sequenceLength }) {
    if (!(start >= 0)) return null;
    if (forward !== false) return (start % 3) + 1;
    if (!(sequenceLength > 0) || !(end >= 0)) return null;
    return -(((sequenceLength - 1 - end) % 3) + 1);
  }

  // Codon-aligned, long enough to mean something, and coding all the way to
  // the end: a stop is allowed as the last codon and nowhere else.
  function readsAsProtein(bases) {
    if (bases.length < 6 || bases.length % 3) return false;
    for (let i = 0; i < bases.length - 3; i += 3) {
      if (STOPS.includes(bases.slice(i, i + 3))) return false;
    }
    return true;
  }

  // A translation row also comes from a CDS feature's own translation, which
  // OVE draws without any frame row being on. A selection inside such a
  // feature, on its strand and codon-aligned to its reading frame, is amino
  // acids off that row.
  //
  // shortcut: a CDS that crosses the origin, or a joined feature, is skipped
  // rather than unwound; revisit if those turn up in practice.
  function inFrameWithCds({ start, end, forward = true, features }) {
    const length = end - start + 1;
    if (!(length >= 6) || length % 3) return false;
    const list = Array.isArray(features) ? features : Object.values(features || {});
    return list.some((f) => {
      if (!f || String(f.type || "").toLowerCase() !== "cds") return false;
      if (!(f.start >= 0) || !(f.end >= f.start)) return false;
      if ((f.forward !== false) !== (forward !== false)) return false;
      if (start < f.start || end > f.end) return false;
      return forward === false
        ? (f.end - end) % 3 === 0
        : (start - f.start) % 3 === 0;
    });
  }

  // The type a new feature over this range should open on, or null to leave
  // OVE's own default alone.
  //
  // Two ways to be a CDS. A clean ORF is one, whether or not anything is on
  // screen. The other is a selection made by picking amino acids off a
  // translation row: those are codon-aligned to a frame the user has
  // displayed, which is what `frames` carries. Without that, a range whose
  // length merely divides by three would be called coding one time in three,
  // which is worse than leaving it alone.
  function typeFor(range) {
    const bases = basesOf(range);
    if (looksLikeOrf(bases)) return "CDS";
    if (inFrameWithCds(range)) return "CDS";
    const frames = range.frames || [];
    if (!frames.length) return null;
    const frame = frameOf({
      start: range.start,
      end: range.end,
      forward: range.forward,
      sequenceLength: (range.sequence || "").length,
    });
    if (frame === null || !frames.includes(frame)) return null;
    return readsAsProtein(bases) ? "CDS" : null;
  }

  return { typeFor, inFrameWithCds, looksLikeOrf, readsAsProtein, frameOf, basesOf, STARTS, STOPS };
});
