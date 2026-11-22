const assert = require("assert");
const C = require("../src/cloning/checkDigest.js");

const RANGE = [200, 10000];

describe("choosing a check digest", () => {
  it("calls two bands unresolved when they are too close in size", () => {
    assert.deepStrictEqual(C.unresolved([3000, 2900, 800]), [[3000, 2900]]);
    assert.deepStrictEqual(C.unresolved([3000, 1000]), []);
  });

  it("flags bands the gel cannot place", () => {
    assert.deepStrictEqual(C.offScale([12000, 3000, 40], RANGE), [12000, 40]);
  });

  it("finds the bands that are not in the parent lane", () => {
    // 4200 is new; 3000 is in both
    assert.deepStrictEqual(C.differences([4200, 3000], [3000, 1000]), [4200]);
  });

  it("rejects a digest whose pattern matches the parent", () => {
    const r = C.score({ enzymes: ["EcoRI"], bands: [3000, 1000], referenceBands: [3000, 1000] }, { range: RANGE });
    assert.strictEqual(r.verdict, "not usable");
    assert.ok(r.reasons.some((x) => /also appears in the parent/.test(x)));
  });

  it("prefers a clean two-band digest over a smear of eight", () => {
    const [best] = C.rank(
      [
        { enzymes: ["BsaI"], bands: [900, 800, 700, 600, 500, 450, 400, 350], referenceBands: [3000] },
        { enzymes: ["EcoRI"], bands: [3200, 1000], referenceBands: [3000] },
      ],
      { range: RANGE }
    );
    assert.deepStrictEqual(best.enzymes, ["EcoRI"]);
    assert.strictEqual(best.verdict, "clear");
  });

  it("marks a digest whose own bands run together", () => {
    const r = C.score({ enzymes: ["XhoI", "XbaI"], bands: [2000, 1750], referenceBands: [3750] }, { range: RANGE });
    assert.ok(r.reasons.some((x) => /run as one band/.test(x)));
    assert.ok(r.score < 30);
  });

  it("says plainly when an enzyme does not cut", () => {
    const r = C.score({ enzymes: ["NotI"], bands: [] }, { range: RANGE });
    assert.strictEqual(r.verdict, "does not cut");
  });

  it("breaks a tie towards the single digest", () => {
    const ranked = C.rank(
      [
        { enzymes: ["A", "B"], bands: [3200, 1000], referenceBands: [3000] },
        { enzymes: ["A"], bands: [3200, 1000], referenceBands: [3000] },
      ],
      { range: RANGE }
    );
    assert.deepStrictEqual(ranked[0].enzymes, ["A"]);
  });
});

describe("the explanation stays readable", () => {
  it("counts the problems instead of listing every band", () => {
    const r = C.score(
      { enzymes: ["DpnI"], bands: [900, 880, 500, 490, 300, 295, 60, 50], referenceBands: [6000] },
      { range: RANGE }
    );
    assert.ok(r.reasons.length <= 4, r.reasons.join(" | "));
    assert.ok(r.reasons.some((x) => /pairs of bands run as one/.test(x)));
    assert.ok(r.reasons.some((x) => /bands are off the end/.test(x)));
    assert.ok(r.reasons.some((x) => /bands are not in the parent lane/.test(x)));
  });
});
