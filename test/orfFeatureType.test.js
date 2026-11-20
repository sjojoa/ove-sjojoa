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

    it("leaves anything else to OVE's own default", () => {
      assert.strictEqual(O.typeFor({ sequence, start: 0, end: 3 }), null);
      assert.strictEqual(O.typeFor({ sequence: "", start: 0, end: 5 }), null);
      assert.strictEqual(O.typeFor({ sequence, start: -1, end: -1 }), null);
    });
  });
});
