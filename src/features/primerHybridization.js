// Where a primer hybridises, under parameters the user can see and change.
//
// The question this answers is "does this primer bind where I think it does,
// and how well" — asked while the primer's own bases are being edited, so it
// has to be cheap enough to run on every keystroke and honest about three
// different things a base can be: paired with the template, mispaired with it,
// or part of a 5' tail that was never meant to pair at all. A view that calls
// a Gibson overlap or a restriction site a mismatch is worse than no view.
//
// Sites are anchored at the primer's 3' end, because that is the end a
// polymerase extends from: a run of matching bases there is what makes a
// binding site, and the match is then grown 5'-ward for as long as the bases
// keep pairing. Whatever is left over at the 5' end is the tail. This is the
// rule the old whole-oligo alignment in cloningTools.js got wrong — it allowed
// a couple of mismatches across the full length of the oligo, which rejects
// every tailed primer outright.
(function (root, factory) {
  const req = typeof require === "function" && typeof module !== "undefined";
  const api = factory(
    req ? require("./mismatchSearch") : root.oveMismatchSearch,
    // dnaTools pulls in @teselagen/sequence-utils, so it is optional: without
    // it the Tm filter simply does not apply.
    req ? require("../cloning/dnaTools") : root.dnaTools
  );
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.ovePrimerHybridization = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (search, dna) {
  // Defaults a newly opened sequence starts from. They are deliberately
  // permissive about tails and strict about the 3' end.
  const DEFAULT_PARAMS = {
    // bases at the 3' end that must pair with the template before anything is
    // called a binding site
    minMatch3Prime: 15,
    // one mismatch, 5' of the protected 3' end, with matching bases either
    // side of it. Two neighbouring mismatches destabilise a duplex far more
    // than two separated ones, so "isolated" is the distinction worth making.
    allowIsolatedMismatch: true,
    // a short stretch can pair perfectly and still not hold at the reaction's
    // temperature
    minTm: 40,
    // sites where the 5' end pairs but the 3' end does not. No product comes
    // off them, so they are off by default, but where a tail anneals is worth
    // knowing.
    show5PrimeOnly: false,
    minMatch5Prime: 15,
  };

  const COMP = {
    a: "t", t: "a", u: "a", g: "c", c: "g", y: "r", r: "y", s: "s", w: "w",
    k: "m", m: "k", b: "v", v: "b", d: "h", h: "d", n: "n", x: "x",
  };
  const comp = (b) => COMP[b] || b;
  const clean = (s) => String(s || "").replace(/[^A-Za-z]/g, "").toLowerCase();
  const pairs = (templateBase, primerBase) =>
    search.basesMatch(templateBase, comp(primerBase), true);

  const tmOf = (seq) => {
    const D = dna || (typeof window !== "undefined" && window.dnaTools);
    if (!D || !seq || seq.length < 2) return NaN;
    const t = D.tm(seq);
    return Number.isFinite(t) ? t : NaN;
  };

  // The template base the primer's base at `k` steps 5'-ward of its 3' end
  // would pair with, or null when the alignment has run off a linear end.
  function partnerAt(seq, anchor, k, bottomStrand, isCircular) {
    const n = seq.length;
    const raw = bottomStrand ? anchor + k : anchor - k;
    if (raw < 0 || raw >= n) {
      if (!isCircular) return null;
      return { index: ((raw % n) + n) % n };
    }
    return { index: raw };
  }

  // One alignment, anchored with the primer's 3'-terminal base on `anchor`.
  function growFrom3Prime(seq, primer, anchor, bottomStrand, params, isCircular) {
    const len = primer.length;
    const n = seq.length;
    const mismatches = [];
    let lastMatch = -1;
    let k = 0;
    for (; k < len && k < n; k++) {
      const at = partnerAt(seq, anchor, k, bottomStrand, isCircular);
      if (!at) break;
      const primerBase = primer[len - 1 - k];
      const templateBase = bottomStrand ? seq[at.index] : comp(seq[at.index]);
      if (pairs(templateBase, primerBase)) {
        lastMatch = k;
        continue;
      }
      // Inside the protected 3' end, a mismatch is fatal: a polymerase will
      // not extend from an unpaired 3' terminus however good the rest looks.
      if (k < params.minMatch3Prime) return null;
      if (!params.allowIsolatedMismatch || mismatches.length) break;
      mismatches.push({
        primerIndex: len - 1 - k,
        templateIndex: at.index,
        base: primerBase.toUpperCase(),
        templateBase: templateBase.toUpperCase(),
      });
    }
    // The annealing region has to end on a pairing base at both ends; a
    // mismatch at its 5' edge is just the first base of the tail.
    const L = lastMatch + 1;
    if (L < params.minMatch3Prime || L < 2) return null;
    const kept = mismatches.filter((m) => len - 1 - m.primerIndex < L);

    const annealSeq = primer.slice(len - L);
    const tm = tmOf(annealSeq);
    if (Number.isFinite(tm) && tm < params.minTm) return null;

    const end3 = anchor;
    const other = bottomStrand ? anchor + L - 1 : anchor - L + 1;
    const wrapped = ((other % n) + n) % n;
    return {
      start: bottomStrand ? end3 : wrapped,
      end: bottomStrand ? wrapped : end3,
      bottomStrand,
      threePrimeEnd: end3,
      annealLength: L,
      annealSeq: annealSeq.toUpperCase(),
      tail: primer.slice(0, len - L).toUpperCase(),
      tailLength: len - L,
      mismatches: kept,
      mismatchCount: kept.length,
      tm,
      fivePrimeOnly: false,
    };
  }

  // The mirror image: the 5' end pairs, the 3' end does not. Nothing extends
  // from these, so they are reported as what they are and never ranked first.
  function growFrom5Prime(seq, primer, anchor, bottomStrand, params, isCircular) {
    const len = primer.length;
    const n = seq.length;
    let matched = 0;
    for (let k = 0; k < len && k < n; k++) {
      // the 5' end sits at `anchor` and the primer runs the other way round
      const raw = bottomStrand ? anchor - k : anchor + k;
      if (raw < 0 || raw >= n) {
        if (!isCircular) break;
      }
      const index = ((raw % n) + n) % n;
      const templateBase = bottomStrand ? seq[index] : comp(seq[index]);
      if (!pairs(templateBase, primer[k])) break;
      matched = k + 1;
    }
    // a primer that pairs all the way through is a 3' site, already reported
    if (matched < params.minMatch5Prime || matched >= len) return null;
    const annealSeq = primer.slice(0, matched);
    const tm = tmOf(annealSeq);
    if (Number.isFinite(tm) && tm < params.minTm) return null;
    const other = bottomStrand ? anchor - matched + 1 : anchor + matched - 1;
    const wrapped = ((other % n) + n) % n;
    return {
      start: bottomStrand ? wrapped : anchor,
      end: bottomStrand ? anchor : wrapped,
      bottomStrand,
      threePrimeEnd: null,
      annealLength: matched,
      annealSeq: annealSeq.toUpperCase(),
      tail: primer.slice(matched).toUpperCase(),
      tailLength: len - matched,
      mismatches: [],
      mismatchCount: 0,
      tm,
      fivePrimeOnly: true,
    };
  }

  // { primer, sites, reason, params }
  function findSites(template, primerBases, options) {
    const opts = options || {};
    const params = Object.assign({}, DEFAULT_PARAMS, opts.params || opts);
    const primer = clean(primerBases);
    const seq = clean(template);
    const isCircular = !!opts.isCircular;
    const out = { primer: primer.toUpperCase(), sites: [], reason: null, params };

    if (!primer) return Object.assign(out, { reason: "no primer bases" });
    if (!seq) return Object.assign(out, { reason: "no template" });
    if (primer.length < params.minMatch3Prime) {
      return Object.assign(out, {
        reason: `this primer is ${primer.length} nt, shorter than the ${params.minMatch3Prime} bases currently required to match at the 3′ end`,
      });
    }

    const sites = [];
    for (let anchor = 0; anchor < seq.length; anchor++) {
      const top = growFrom3Prime(seq, primer, anchor, false, params, isCircular);
      if (top) sites.push(top);
      const bottom = growFrom3Prime(seq, primer, anchor, true, params, isCircular);
      if (bottom) sites.push(bottom);
      if (params.show5PrimeOnly) {
        const t5 = growFrom5Prime(seq, primer, anchor, false, params, isCircular);
        if (t5) sites.push(t5);
        const b5 = growFrom5Prime(seq, primer, anchor, true, params, isCircular);
        if (b5) sites.push(b5);
      }
    }

    sites.sort(
      (a, b) =>
        (a.fivePrimeOnly ? 1 : 0) - (b.fivePrimeOnly ? 1 : 0) ||
        a.mismatchCount - b.mismatchCount ||
        b.annealLength - a.annealLength ||
        a.start - b.start ||
        (a.bottomStrand ? 1 : 0) - (b.bottomStrand ? 1 : 0)
    );
    out.sites = sites;
    if (!sites.length) {
      out.reason = `no binding site: no ${params.minMatch3Prime}+ base stretch at this primer's 3′ end pairs with the template${
        params.allowIsolatedMismatch ? " (one isolated mismatch allowed further 5′)" : ""
      }`;
    }
    return out;
  }

  // Per-base, 5'→3' along the primer, for rendering: what each base is and
  // what it is sitting over.
  // [{ base, state: "tail" | "match" | "mismatch", templateIndex, partner }]
  function alignment(site, primerIn, template) {
    const primer = clean(primerIn || "");
    const seq = clean(template || "");
    const len = primer.length;
    const n = seq.length;
    const mm = new Set(site.mismatches.map((m) => m.primerIndex));
    const out = [];
    for (let i = 0; i < len; i++) {
      // k counts 5'-ward from the 3' end for a 3'-anchored site; a 5'-only
      // site is anchored the other way round
      const inAnneal = site.fivePrimeOnly ? i < site.annealLength : i >= len - site.annealLength;
      let templateIndex = null;
      if (inAnneal && n) {
        const raw = site.fivePrimeOnly
          ? site.bottomStrand
            ? (site.end - i)
            : (site.start + i)
          : site.bottomStrand
          ? site.start + (len - 1 - i)
          : site.end - (len - 1 - i);
        templateIndex = ((raw % n) + n) % n;
      }
      const partner =
        templateIndex === null
          ? null
          : (site.bottomStrand ? seq[templateIndex] : comp(seq[templateIndex])).toUpperCase();
      out.push({
        base: primer[i].toUpperCase(),
        state: !inAnneal ? "tail" : mm.has(i) ? "mismatch" : "match",
        templateIndex,
        partner,
      });
    }
    return out;
  }

  // "1 240–259 (top) · 20 nt annealing · 6 nt 5′ tail · 1 mismatch · Tm 61.2 °C"
  function describe(site) {
    const bits = [
      `${site.start + 1}–${site.end + 1} (${site.bottomStrand ? "bottom" : "top"} strand)`,
      `${site.annealLength} nt annealing`,
    ];
    if (site.tailLength) bits.push(`${site.tailLength} nt ${site.fivePrimeOnly ? "3′" : "5′"} tail`);
    if (site.mismatchCount)
      bits.push(
        `${site.mismatchCount} mismatch${site.mismatchCount > 1 ? "es" : ""} (${site.mismatches
          .map((m) => `${m.templateIndex + 1} ${m.templateBase}·${m.base}`)
          .join(", ")})`
      );
    if (Number.isFinite(site.tm)) bits.push(`Tm ${site.tm.toFixed(1)} °C`);
    if (site.fivePrimeOnly) bits.push("5′ end only — will not extend");
    return bits.join(" · ");
  }

  const reverseComplement = (seq) => search.reverseComplement(clean(seq)).toUpperCase();

  return { findSites, alignment, describe, reverseComplement, DEFAULT_PARAMS };
});
