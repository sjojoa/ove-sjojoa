const assert = require("assert");
const { findMatches, describe: describeMatch, reverseComplement } = require("../src/features/mismatchSearch");

const forward = (hits) => hits.filter((h) => !h.bottomStrand);
const at = (hits, start) => hits.find((h) => h.start === start);

describe("mismatch search: exact hits", () => {
  const seq = "AAACCCGGGTTTAAATTTGGG";

  it("finds an exact match on the top strand", () => {
    const hits = forward(findMatches(seq, "cccggg", { mismatches: 0 }));
    assert.deepStrictEqual(hits.map((h) => [h.start, h.end]), [[3, 8]]);
    assert.strictEqual(hits[0].mismatchCount, 0);
  });

  it("is case-insensitive both ways", () => {
    assert.strictEqual(forward(findMatches(seq, "CCCGGG", { mismatches: 0 })).length, 1);
    assert.strictEqual(forward(findMatches(seq.toLowerCase(), "cccggg", { mismatches: 0 })).length, 1);
  });

  it("ignores whitespace in the query, as pasted sequences carry it", () => {
    assert.strictEqual(forward(findMatches(seq, "ccc ggg", { mismatches: 0 })).length, 1);
  });

  it("searches the bottom strand too", () => {
    // 3..8 is GGATTC, whose reverse complement is GAATCC
    const s = "AAAGGATTCCCTTT";
    const hits = findMatches(s, "gaatcc", { mismatches: 0 });
    const bottom = hits.filter((h) => h.bottomStrand);
    assert.deepStrictEqual(bottom.map((h) => [h.start, h.end]), [[3, 8]]);
    assert.strictEqual(reverseComplement(s.slice(3, 9)), "gaatcc");
  });

  it("finds nothing when there is nothing to find", () => {
    assert.deepStrictEqual(findMatches(seq, "ggggggggggggg", { mismatches: 0 }), []);
    assert.deepStrictEqual(findMatches(seq, "", { mismatches: 2 }), []);
    assert.deepStrictEqual(findMatches("", "acgt", { mismatches: 2 }), []);
  });
});

describe("mismatch search: tolerating mismatches", () => {
  const seq = "AAACCCGGGTTT";

  it("finds a hit one base off", () => {
    const hits = forward(findMatches(seq, "cacggg", { mismatches: 1 }));
    assert.deepStrictEqual(hits.map((h) => [h.start, h.end, h.mismatchCount]), [[3, 8, 1]]);
  });

  it("does not find it when no mismatches are allowed", () => {
    assert.deepStrictEqual(forward(findMatches(seq, "cacggg", { mismatches: 0 })), []);
  });

  it("respects the budget exactly", () => {
    assert.strictEqual(forward(findMatches(seq, "cacgga", { mismatches: 1 })).length, 0);
    assert.strictEqual(forward(findMatches(seq, "cacgga", { mismatches: 2 })).length, 1);
  });

  it("reports which bases differ, and what they are", () => {
    const hit = at(forward(findMatches(seq, "cacggg", { mismatches: 1 })), 3);
    assert.deepStrictEqual(hit.mismatches, [{ index: 4, found: "C", expected: "A" }]);
  });

  it("reads mismatches off the bottom strand in that strand's direction", () => {
    // same 3..8 hit, with the query's last base changed from C to A: that base
    // reads against forward position 3, where the bottom strand has a C
    const s = "AAAGGATTCCCTTT";
    const hits = findMatches(s, "gaatca", { mismatches: 1 }).filter((h) => h.bottomStrand);
    assert.deepStrictEqual(hits.map((h) => [h.start, h.end, h.mismatchCount]), [[3, 8, 1]]);
    assert.deepStrictEqual(hits[0].mismatches, [{ index: 3, found: "C", expected: "A" }]);
  });

  it("orders hits best-first, so an exact match is never buried", () => {
    //         exact at 0..3, one-off at 10..13
    const s = "ACGTTTTTTTACGA";
    const hits = forward(findMatches(s, "acgt", { mismatches: 1 }));
    assert.strictEqual(hits[0].mismatchCount, 0);
    assert.strictEqual(hits[0].start, 0);
    assert.ok(hits.some((h) => h.start === 10 && h.mismatchCount === 1));
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i - 1].mismatchCount <= hits[i].mismatchCount, "sorted by mismatch count");
    }
  });
});

describe("mismatch search: ambiguity codes", () => {
  it("treats N as any base in ambiguous mode", () => {
    assert.strictEqual(forward(findMatches("AAACCCGGG", "cnc", { mismatches: 0, ambiguous: true })).length, 1);
  });

  it("counts N as a mismatch in literal mode", () => {
    assert.strictEqual(forward(findMatches("AAACCCGGG", "cnc", { mismatches: 0 })).length, 0);
    assert.strictEqual(forward(findMatches("AAACCCGGG", "cnc", { mismatches: 1 })).length, 1);
  });

  it("matches a code against a base it stands for", () => {
    // Y is C or T
    assert.strictEqual(forward(findMatches("AAACCCGGG", "cyc", { mismatches: 0, ambiguous: true })).length, 1);
    // R is A or G, which the C here is not
    assert.strictEqual(forward(findMatches("AAACCCGGG", "crc", { mismatches: 0, ambiguous: true })).length, 0);
  });
});

describe("mismatch search: circular sequences", () => {
  const seq = "GGGTTTAAACCC"; // a hit spanning the origin: ccc|ggg

  it("finds a hit that wraps the origin", () => {
    const hits = forward(findMatches(seq, "cccggg", { mismatches: 0, isCircular: true }));
    assert.deepStrictEqual(hits.map((h) => [h.start, h.end]), [[9, 2]]);
  });

  it("does not find it on a linear sequence", () => {
    assert.deepStrictEqual(forward(findMatches(seq, "cccggg", { mismatches: 0 })), []);
  });

  it("reports wrapped mismatch positions inside the sequence", () => {
    const hits = forward(findMatches(seq, "cacggg", { mismatches: 1, isCircular: true }));
    assert.strictEqual(hits.length, 1);
    hits[0].mismatches.forEach((m) => {
      assert.ok(m.index >= 0 && m.index < seq.length);
    });
    assert.deepStrictEqual(hits[0].mismatches, [{ index: 10, found: "C", expected: "A" }]);
  });

  it("does not report the same hit twice from the doubled sequence", () => {
    const hits = findMatches("ACGTACGTACGT", "acgt", { mismatches: 0, isCircular: true });
    const keys = hits.map((h) => `${h.bottomStrand}:${h.start}`);
    assert.strictEqual(new Set(keys).size, keys.length);
  });
});

describe("mismatch search: describing a hit", () => {
  it("says exact when there is nothing to report", () => {
    assert.strictEqual(describeMatch({ mismatchCount: 0, mismatches: [] }), "exact match");
  });

  it("lists the differences, 1-based", () => {
    assert.strictEqual(
      describeMatch({
        mismatchCount: 2,
        mismatches: [
          { index: 411, found: "A", expected: "G" },
          { index: 417, found: "T", expected: "C" },
        ],
      }),
      "2 mismatches: 412 A>G, 418 T>C"
    );
  });

  it("says mismatch, singular, when there is one", () => {
    assert.match(describeMatch({ mismatchCount: 1, mismatches: [{ index: 0, found: "A", expected: "G" }] }), /^1 mismatch: /);
  });
});
