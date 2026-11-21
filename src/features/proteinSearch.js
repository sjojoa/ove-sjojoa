// Searching for an amino-acid sequence, kept to the frames on screen.
//
// OVE already translates all three frames of both strands and matches the
// query against them, which is the right way to do it -- one peptide maps to
// many DNA sequences, so this has to be translate-and-compare. The trouble is
// that every frame answers: a four-residue query hit twice in a test plasmid
// and a three-residue one hit eight times, nearly all of them in frames that
// encode nothing in the construct.
//
// So a hit only counts if the user can actually see the reading frame it sits
// in: a +1/+2/+3 row they have turned on, a CDS feature's own translation, or
// an ORF row. Those are the same three ways of seeing amino acids that decide
// whether a new feature opens as a CDS, so the tests there cover this too.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveProteinSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // orfFeatureType.js owns the "is this reading frame on screen" question.
  function orf() {
    if (typeof window !== "undefined" && window.oveOrfFeatureType) {
      return window.oveOrfFeatureType;
    }
    return require("./orfFeatureType.js");
  }

  // The frame rows that are switched on, as 1..3 / -1..-3.
  function framesShown(frameTranslations) {
    const shown = frameTranslations || {};
    return Object.keys(shown)
      .filter((f) => shown[f])
      .map(Number)
      .filter((f) => f === f); // drop keys that are not numbers
  }

  // shortcut: a match that wraps the origin is kept without checking its
  // frame; unwinding one is work for the day someone searches across it.
  function wraps(match) {
    return match.start > match.end;
  }

  function isShown(match, opts) {
    const sequence = opts.sequence || "";
    const forward = !match.bottomStrand;
    if (wraps(match)) return true;

    const frames = opts.frames || [];
    if (frames.length) {
      const frame = orf().frameOf({
        start: match.start,
        end: match.end,
        forward: forward,
        sequenceLength: sequence.length,
      });
      if (frame !== null && frames.includes(frame)) return true;
    }

    const range = {
      sequence: sequence,
      start: match.start,
      end: match.end,
      forward: forward,
    };
    if (orf().inFrameWithCds(Object.assign({ features: opts.features }, range))) {
      return true;
    }
    return orf().inDisplayedOrf(
      Object.assign(
        {
          orfsShown: !!opts.orfsShown,
          minimumOrfSize: opts.minimumOrfSize || 0,
        },
        range
      )
    );
  }

  // Is there any reading frame on screen to judge a hit against? With no frame
  // rows, no ORFs and no CDS feature there is nothing to scope the search to,
  // and hiding every hit would just look broken -- so leave them all.
  function hasScope(opts) {
    if ((opts.frames || []).length) return true;
    if (opts.orfsShown) return true;
    const features = opts.features;
    const list = Array.isArray(features)
      ? features
      : Object.values(features || {});
    return list.some((f) => f && String(f.type || "").toLowerCase() === "cds");
  }

  function inScope(matches, opts) {
    const all = matches || [];
    if (!opts || !opts.sequence || !hasScope(opts)) return all;
    return all.filter((m) => isShown(m, opts));
  }

  return { inScope, isShown, hasScope, framesShown };
});
