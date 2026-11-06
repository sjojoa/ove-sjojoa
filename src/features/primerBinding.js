// Where does a pasted primer bind on this template?
//
// A primer is not just its annealing sequence: it often carries a 5' tail that
// does not match the template at all — a restriction site, an overhang, a tag.
// Only the 3' portion anneals, and the tail still ends up in the product. So
// this looks for the longest 3' suffix of the primer that is present in the
// template, and calls whatever is left over the tail.
//
// Direction falls out of the search rather than being asked for: a primer whose
// bases are found on the top strand primes rightward (forward), and one found
// on the bottom strand primes leftward (reverse).
(function (root, factory) {
  const api = factory(
    typeof require === "function" && typeof module !== "undefined"
      ? require("./mismatchSearch")
      : root.oveMismatchSearch
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.ovePrimerBinding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (search) {
  const DEFAULTS = {
    minAnneal: 12, // shorter than this is not a binding site worth reporting
    maxMismatches: 2,
    protect3Prime: 5, // bases at the 3' end that must match exactly
  };

  const clean = (s) => String(s || "").replace(/[^A-Za-z]/g, "").toLowerCase();

  // A mismatch inside the last few bases of the 3' end stops a primer
  // extending, so a site with one there is not a site.
  function threePrimeClean(match, protect) {
    return match.mismatches.every((m) => {
      const fromThreePrime = match.bottomStrand ? m.index - match.start : match.end - m.index;
      // on a circular template the hit can wrap, in which case the simple
      // subtraction is negative; the modulo puts it back
      return fromThreePrime >= protect || fromThreePrime < 0;
    });
  }

  // { ok, orientation, sites, site, annealLength, tail, annealSeq, mismatches, reason }
  function bindPrimer(template, primerBases, options) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const primer = clean(primerBases);
    const seq = clean(template);
    if (!primer) return { ok: false, reason: "no primer bases", sites: [] };
    if (primer.length < opts.minAnneal) {
      return {
        ok: false,
        reason: `a primer needs at least ${opts.minAnneal} bases to place`,
        sites: [],
      };
    }
    if (!seq) return { ok: false, reason: "no template", sites: [] };

    const isCircular = !!opts.isCircular;
    // A perfect match is looked for first, at the longest length, and only then
    // are mismatches considered. The other way round, a tail base that happens
    // to match the template would win a longer-but-mismatched site over the
    // real annealing region. The cost is that a mismatch close to the 5' end of
    // a primer designed against a variant template is reported as part of the
    // tail rather than as a mismatch — the product is identical either way.
    for (let allowed = 0; allowed <= opts.maxMismatches; allowed++) {
      for (let L = primer.length; L >= opts.minAnneal; L--) {
        const suffix = primer.slice(primer.length - L);
        const sites = search
          .findMatches(seq, suffix, {
            isCircular,
            mismatches: allowed,
            searchReverseStrand: true,
          })
          .filter((m) => m.mismatchCount === allowed && threePrimeClean(m, opts.protect3Prime));
        if (!sites.length) continue;
        return {
          ok: true,
          sites,
          site: sites[0],
          orientation: sites[0].bottomStrand ? "reverse" : "forward",
          annealLength: L,
          annealSeq: suffix,
          tail: primer.slice(0, primer.length - L),
          mismatches: allowed,
          reason: null,
        };
      }
    }
    return {
      ok: false,
      sites: [],
      reason: `no binding site: no ${opts.minAnneal}+ base stretch of this primer's 3' end matches the template (up to ${opts.maxMismatches} mismatches, with the last ${opts.protect3Prime} bases exact)`,
    };
  }

  // A primer annotation the editor's PCR tool can use: the footprint is where
  // it anneals, `bases` is the whole primer including the tail, which is what
  // ends up in the product.
  function virtualPrimer(binding, { name, id }) {
    if (!binding || !binding.ok) return null;
    const site = binding.site;
    return {
      id,
      name,
      start: site.start,
      end: site.end,
      forward: !site.bottomStrand,
      bases: (binding.tail + binding.annealSeq).toUpperCase(),
      type: "primer_bind",
      ovePasted: true,
    };
  }

  return { bindPrimer, virtualPrimer, DEFAULTS };
});
