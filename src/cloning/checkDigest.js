// Which digest proves you got the right clone.
//
// After a ligation or an assembly the next question is always "cut it with
// what, to tell a right colony from a wrong one". That means a digest whose
// bands you can actually resolve on a gel, and whose pattern differs from
// the parent you started with. This scores candidate digests on both counts.
//
// Pure: the caller does the cutting and passes band sizes in, so the scoring
// can be tested without a sequence.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveCheckDigest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // Two bands this close in size run as one. 1.25 is about what a 1% gel
  // shows in the middle of its range.
  const SEPARATION = 1.25;

  const sorted = (sizes) => (sizes || []).slice().sort((a, b) => b - a);

  // Bands that would run together, as [bigger, smaller] pairs.
  function unresolved(sizes, separation = SEPARATION) {
    const s = sorted(sizes);
    const out = [];
    for (let i = 0; i + 1 < s.length; i++) {
      if (s[i] / s[i + 1] < separation) out.push([s[i], s[i + 1]]);
    }
    return out;
  }

  // Bands too small or too big for the gel to place.
  function offScale(sizes, range) {
    if (!range) return [];
    return sorted(sizes).filter((s) => s < range[0] || s > range[1]);
  }

  // Does this pattern look different from the parent's? A band counts as
  // telling them apart when the other lane has nothing near its size.
  function differences(sizes, referenceSizes, separation = SEPARATION) {
    const ref = sorted(referenceSizes);
    return sorted(sizes).filter((s) => !ref.some((r) => Math.max(r, s) / Math.min(r, s) < separation));
  }

  // One candidate digest, scored. Higher is better; a negative score means
  // it cannot be read.
  function score(candidate, { range, separation = SEPARATION, idealBands = [2, 4] } = {}) {
    const bands = sorted(candidate.bands);
    const reasons = [];
    let points = 0;

    if (!bands.length) return { ...candidate, bands, score: -100, verdict: "does not cut", reasons: ["no cut sites"] };

    const together = unresolved(bands, separation);
    const off = offScale(bands, range);
    const tells = candidate.referenceBands ? differences(bands, candidate.referenceBands, separation) : null;

    if (candidate.referenceBands && !tells.length) {
      reasons.push("every band also appears in the parent lane");
      points -= 50;
    } else if (tells && tells.length) {
      // a bad digest can differ in dozens of bands; say how many, not which
      reasons.push(
        tells.length > 2
          ? `${tells.length} bands are not in the parent lane`
          : `${tells.map((b) => `${b} bp`).join(" and ")} ${tells.length > 1 ? "are" : "is"} not in the parent lane`
      );
      points += 30;
    }

    if (together.length === 1) {
      reasons.push(`${together[0][0]} and ${together[0][1]} bp run as one band`);
    } else if (together.length) {
      reasons.push(`${together.length} pairs of bands run as one`);
    }
    points -= 30 * together.length;

    if (off.length === 1) {
      reasons.push(`${off[0]} bp is off the end of this gel`);
    } else if (off.length) {
      reasons.push(`${off.length} bands are off the end of this gel`);
    }
    points -= 10 * off.length;

    if (bands.length < idealBands[0]) {
      points -= 5;
    } else if (bands.length > idealBands[1]) {
      reasons.push(`${bands.length} bands is a lot to read`);
      points -= 3 * (bands.length - idealBands[1]);
    } else {
      points += 10;
    }

    // a big, obvious size difference beats a marginal one
    if (tells && tells.length) points += Math.min(10, Math.round(Math.log10(Math.max(...tells)) * 3));

    const verdict = points >= 30 ? "clear" : points >= 0 ? "workable" : "not usable";
    return { ...candidate, bands, score: points, verdict, reasons, unresolved: together, offScale: off, tells: tells };
  }

  // Best digest first. Ties break towards fewer enzymes, then fewer bands.
  function rank(candidates, options) {
    return (candidates || [])
      .map((c) => score(c, options))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.enzymes || []).length - (b.enzymes || []).length ||
          a.bands.length - b.bands.length
      );
  }

  return { rank, score, unresolved, offScale, differences, SEPARATION };
});
