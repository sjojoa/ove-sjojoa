// Mismatch-tolerant sequence search.
//
// The find tool matches exactly (plus ambiguity codes), which is no help for
// the cases this comes up in: a primer designed against a slightly different
// template, a motif that varies by a base or two, checking whether a region
// survived mutagenesis, or a primer's near-miss off-target site elsewhere in
// the plasmid. This finds those, and says which bases differ, because a hit
// highlighted uniformly hides the very thing being looked for.
//
// Plain sliding window: O(n·m) with an early exit once a window is over
// budget. A 10 kb plasmid against a 25-mer is a few hundred thousand
// comparisons, which is nothing per keystroke, and it keeps the mismatch
// positions in hand instead of recovering them from a regex afterwards.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveMismatchSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COMPLEMENT = {
    a: "t", t: "a", u: "a", g: "c", c: "g", y: "r", r: "y", s: "s", w: "w",
    k: "m", m: "k", b: "v", v: "b", d: "h", h: "d", n: "n", x: "x",
  };
  // what each IUPAC code stands for
  const CODES = {
    a: "a", c: "c", g: "g", t: "t", u: "t",
    r: "ag", y: "ct", s: "cg", w: "at", k: "gt", m: "ac",
    b: "cgt", d: "agt", h: "act", v: "acg", n: "acgt", x: "acgt", ".": "acgt", "-": "acgt",
  };

  const reverseComplement = (seq) =>
    seq
      .toLowerCase()
      .split("")
      .reverse()
      .map((c) => COMPLEMENT[c] || c)
      .join("");

  // Exact mode compares letters, so N in the sequence is a mismatch against A
  // just as the find tool's literal mode has it. Ambiguous mode asks whether
  // the two codes have any base in common, which is what makes N match
  // anything and Y match C.
  function basesMatch(a, b, ambiguous) {
    if (a === b) return true;
    if (!ambiguous) return false;
    const setA = CODES[a];
    const setB = CODES[b];
    if (!setA || !setB) return false;
    for (let i = 0; i < setA.length; i++) {
      if (setB.indexOf(setA[i]) !== -1) return true;
    }
    return false;
  }

  // Hits on one strand of one string. Positions are indices into `sequence`.
  function scan(sequence, query, maxMismatches, ambiguous) {
    const hits = [];
    const n = sequence.length;
    const m = query.length;
    if (!m || m > n) return hits;
    for (let start = 0; start + m <= n; start++) {
      const mismatches = [];
      let over = false;
      for (let i = 0; i < m; i++) {
        if (!basesMatch(sequence[start + i], query[i], ambiguous)) {
          if (mismatches.length === maxMismatches) {
            over = true;
            break;
          }
          mismatches.push(start + i);
        }
      }
      if (!over) hits.push({ start, end: start + m - 1, mismatches });
    }
    return hits;
  }

  // { start, end, bottomStrand, mismatches: [{index, found, expected}], mismatchCount }
  // start/end are 0-based inclusive and may wrap the origin (start > end) on a
  // circular sequence, the same convention the editor's own ranges use.
  function findMatches(sequence, query, options) {
    const opts = options || {};
    const max = Math.max(0, Math.floor(opts.mismatches || 0));
    const ambiguous = !!opts.ambiguous;
    const seq = String(sequence || "").toLowerCase();
    const q = String(query || "").replace(/\s/g, "").toLowerCase();
    const len = seq.length;
    if (!q || !len) return [];

    const out = [];
    const seen = new Set();
    const add = (hit, bottomStrand) => {
      // on a circular sequence the search runs over the doubled string, so a
      // hit starting past the end is the same hit found twice
      if (hit.start >= len) return;
      const start = hit.start % len;
      const end = hit.end % len;
      const key = `${bottomStrand ? "-" : "+"}:${start}:${end}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        start,
        end,
        bottomStrand,
        mismatchCount: hit.mismatches.length,
        mismatches: hit.mismatches.map((index) => {
          const at = index % len;
          return {
            index: at,
            // what the sequence has, read 5'->3' on the strand searched
            found: (bottomStrand ? COMPLEMENT[seq[at]] || seq[at] : seq[at]).toUpperCase(),
            expected: q[bottomStrand ? hit.end - index : index - hit.start].toUpperCase(),
          };
        }),
      });
    };

    const topString = opts.isCircular && len > q.length ? seq + seq : seq;
    scan(topString, q, max, ambiguous).forEach((hit) => add(hit, false));

    if (opts.searchReverseStrand !== false) {
      // search the reverse complement, then flip the coordinates back
      const rc = reverseComplement(topString);
      const rcLen = rc.length;
      scan(rc, q, max, ambiguous).forEach((hit) => {
        add(
          {
            start: rcLen - 1 - hit.end,
            end: rcLen - 1 - hit.start,
            mismatches: hit.mismatches.map((i) => rcLen - 1 - i).sort((a, b) => a - b),
          },
          true
        );
      });
    }

    // best first, so an exact hit is never buried under approximate ones
    out.sort(
      (a, b) =>
        a.mismatchCount - b.mismatchCount ||
        a.start - b.start ||
        (a.bottomStrand ? 1 : 0) - (b.bottomStrand ? 1 : 0)
    );
    return out;
  }

  // "2 mismatches: 412 A>G, 418 T>C" — 1-based, like everything the user sees
  function describe(match) {
    if (!match.mismatchCount) return "exact match";
    const detail = match.mismatches
      .map((m) => `${m.index + 1} ${m.found}>${m.expected}`)
      .join(", ");
    return `${match.mismatchCount} mismatch${match.mismatchCount > 1 ? "es" : ""}: ${detail}`;
  }

  return { findMatches, describe, reverseComplement, basesMatch };
});
