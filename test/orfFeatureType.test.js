const assert = require("assert");
const O = require("../src/features/orfFeatureType.js");

const rc = (s) => s.split("").reverse().map((c) => ({ A: "T", T: "A", G: "C", C: "G" }[c])).join("");
const orf = "ATG" + "AAACCCGGGTTT" + "TAA"; // 18 nt, clean

describe("a feature drawn over an ORF opens as a CDS", () => {
  describe("what counts as an ORF", () => {
    it("start codon, whole codons, stop at the end", () => {
      assert.strictEqual(O.looksLikeOrf(orf), true);
      assert.strictEqual(O.looksLikeOrf("GTGAAATAG"), true, "GTG is a start codon too");
    });

    it("rejects a stop inside it", () => {
      assert.strictEqual(O.looksLikeOrf("ATGTGAAAATAA"), false);
    });

    it("rejects a range that is not whole codons", () => {
      assert.strictEqual(O.looksLikeOrf(orf + "A"), false);
    });

    it("rejects one that does not start or does not stop", () => {
      assert.strictEqual(O.looksLikeOrf("AAACCCGGGTAA"), false);
      assert.strictEqual(O.looksLikeOrf("ATGAAACCCGGG"), false);
    });

    it("rejects something too short to be either", () => {
      assert.strictEqual(O.looksLikeOrf("ATG"), false);
      assert.strictEqual(O.looksLikeOrf(""), false);
    });
  });

  describe("reading the selection", () => {
    const sequence = "CCCC" + orf + "GGGG";

    it("calls a forward ORF a CDS", () => {
      assert.strictEqual(O.typeFor({ sequence, start: 4, end: 4 + orf.length - 1 }), "CDS");
    });

    it("calls a bottom-strand ORF a CDS, read the other way", () => {
      const seq = "CCCC" + rc(orf) + "GGGG";
      assert.strictEqual(O.typeFor({ sequence: seq, start: 4, end: 4 + orf.length - 1, forward: false }), "CDS");
      // and not when read the wrong way round
      assert.strictEqual(O.typeFor({ sequence: seq, start: 4, end: 4 + orf.length - 1 }), null);
    });

    it("reads an ORF that crosses the origin of a plasmid", () => {
      // last 9 bases of the ORF at the front, first 9 at the back
      const seq = orf.slice(9) + "TTTTT" + orf.slice(0, 9);
      assert.strictEqual(O.typeFor({ sequence: seq, start: 14, end: 8, circular: true }), "CDS");
      assert.strictEqual(O.typeFor({ sequence: seq, start: 14, end: 8, circular: false }), null);
    });

    it("leaves a codon-aligned range alone when no frame is displayed", () => {
      // one range in three divides by three; without a displayed frame to
      // line it up with, calling that coding would be guessing
      assert.strictEqual(O.typeFor({ sequence, start: 4, end: 4 + 11 }), null);
    });

    it("leaves anything else to OVE's own default", () => {
      assert.strictEqual(O.typeFor({ sequence, start: 0, end: 3 }), null);
      assert.strictEqual(O.typeFor({ sequence: "", start: 0, end: 5 }), null);
      assert.strictEqual(O.typeFor({ sequence, start: -1, end: -1 }), null);
    });
  });
});

describe("a feature drawn over amino acids opens as a CDS", () => {
  // 30 nt of coding sequence with no stop in it, placed so it starts in
  // frame 1 (0-based index 0, 3, 6 ... are frame 1)
  const coding = "ATGAAACCCGGGTTTAAACCCGGGTTTAAA";
  const sequence = coding + "TTTTTTTTT";

  it("says CDS for a codon-aligned selection in a frame that is shown", () => {
    assert.strictEqual(
      O.typeFor({ sequence, start: 0, end: coding.length - 1, frames: [1] }),
      "CDS"
    );
  });

  it("says nothing when that frame is not displayed", () => {
    assert.strictEqual(
      O.typeFor({ sequence, start: 0, end: coding.length - 1, frames: [2, 3] }),
      null
    );
  });

  it("says nothing for a selection that is not codon-aligned to a shown frame", () => {
    // starts at 1, which is frame 2, while only frame 1 is displayed
    assert.strictEqual(O.typeFor({ sequence, start: 1, end: 12, frames: [1] }), null);
  });

  it("says nothing when a stop sits inside the selection", () => {
    const withStop = "ATGAAATGACCCGGGTTTAAACCCGGGTTT";
    assert.strictEqual(
      O.typeFor({ sequence: withStop + "AAA", start: 0, end: withStop.length - 1, frames: [1] }),
      null
    );
  });

  it("allows a stop as the last codon, which is where one belongs", () => {
    const toStop = "ATGAAACCCGGGTTTAAACCCGGGTTTTAA";
    assert.strictEqual(
      O.typeFor({ sequence: toStop, start: 0, end: toStop.length - 1, frames: [1] }),
      "CDS"
    );
  });

  describe("which frame a range sits in", () => {
    it("counts the top strand from the start", () => {
      assert.strictEqual(O.frameOf({ start: 0, end: 8 }), 1);
      assert.strictEqual(O.frameOf({ start: 1, end: 9 }), 2);
      assert.strictEqual(O.frameOf({ start: 2, end: 10 }), 3);
      assert.strictEqual(O.frameOf({ start: 3, end: 11 }), 1);
    });

    it("counts the bottom strand back from the end of the sequence", () => {
      assert.strictEqual(O.frameOf({ start: 0, end: 29, forward: false, sequenceLength: 30 }), -1);
      assert.strictEqual(O.frameOf({ start: 0, end: 28, forward: false, sequenceLength: 30 }), -2);
    });

    it("has no answer without the length it needs", () => {
      assert.strictEqual(O.frameOf({ start: 0, end: 29, forward: false }), null);
      assert.strictEqual(O.frameOf({ start: -1, end: -1 }), null);
    });
  });
});
