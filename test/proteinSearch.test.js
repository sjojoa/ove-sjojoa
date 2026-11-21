const assert = require("assert");
const P = require("../src/features/proteinSearch.js");

// 10 N, then a CDS at 10..57 (ATG + 14 codons + TAA), then filler.
const seq = "N".repeat(10) + "ATG" + "AAA".repeat(14) + "TAA" + "N".repeat(20);
const cds = [{ type: "CDS", start: 10, end: 57, forward: true }];
const inCds = { start: 13, end: 24 };          // codon-aligned inside the CDS
const offFrame = { start: 14, end: 25 };       // same length, wrong frame
const outside = { start: 60, end: 71 };        // past the CDS

describe("an amino-acid search is kept to the frames on screen", () => {
  it("keeps a hit in a frame row that is turned on", () => {
    const kept = P.inScope([offFrame], { sequence: seq, frames: [3], features: [] });
    assert.deepStrictEqual(kept, [offFrame]);
  });

  it("drops a hit whose frame is not displayed", () => {
    assert.deepStrictEqual(
      P.inScope([offFrame], { sequence: seq, frames: [1], features: cds }),
      []
    );
  });

  it("keeps a hit that is in frame with a CDS feature", () => {
    assert.deepStrictEqual(
      P.inScope([inCds], { sequence: seq, features: cds }),
      [inCds]
    );
  });

  it("drops a hit outside every CDS when no frame row is on", () => {
    assert.deepStrictEqual(P.inScope([outside], { sequence: seq, features: cds }), []);
  });

  it("keeps both when one of several hits is in scope", () => {
    const kept = P.inScope([inCds, outside, offFrame], { sequence: seq, features: cds });
    assert.deepStrictEqual(kept, [inCds]);
  });

  it("reads a bottom-strand hit on its own strand", () => {
    const rev = [{ type: "CDS", start: 10, end: 57, forward: false }];
    const hit = { start: 13, end: 24, bottomStrand: true };
    assert.deepStrictEqual(P.inScope([hit], { sequence: seq, features: rev }), [hit]);
    assert.deepStrictEqual(P.inScope([hit], { sequence: seq, features: cds }), []);
  });

  describe("when there is nothing on screen to scope against", () => {
    it("leaves every hit alone rather than hiding them all", () => {
      const hits = [inCds, outside, offFrame];
      assert.deepStrictEqual(P.inScope(hits, { sequence: seq, features: [] }), hits);
      assert.strictEqual(P.hasScope({ sequence: seq, features: [] }), false);
    });

    it("counts a displayed ORF as scope", () => {
      assert.strictEqual(P.hasScope({ orfsShown: true, features: [] }), true);
    });
  });

  it("ignores frame keys that are switched off", () => {
    assert.deepStrictEqual(
      P.framesShown({ 1: true, 2: false, "-1": true, "-2": false }),
      [1, -1]
    );
  });

  it("keeps a hit that wraps the origin rather than guessing its frame", () => {
    const wrapped = { start: 70, end: 4 };
    assert.deepStrictEqual(
      P.inScope([wrapped], { sequence: seq, features: cds }),
      [wrapped]
    );
  });
});
