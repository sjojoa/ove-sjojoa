const assert = require("assert");
const { findMismatchRanges } = require("../src/alignment/mismatchNavigator");

const tracks = (...seqs) => seqs.map((sequence) => ({ alignmentData: { sequence } }));

describe("mismatchNavigator", () => {
  it("finds SNPs, groups indels, and is case-insensitive", () => {
    const ranges = findMismatchRanges(
      tracks("ACGTAC--GTACGT", "acGTTC--GTACGT", "ACGTACTTGT---T")
    );
    assert.deepStrictEqual(ranges, [
      { start: 4, end: 4 }, // SNP in read 1
      { start: 6, end: 7 }, // 2 bp insertion in read 2
      { start: 10, end: 12 }, // 3 bp deletion in read 2
    ]);
  });

  it("ignores the unsequenced ends of reads", () => {
    assert.deepStrictEqual(findMismatchRanges(tracks("ACGTACGTAC", "---TACGA--")), [
      { start: 7, end: 7 },
    ]);
  });

  it("returns nothing without a second track", () => {
    assert.deepStrictEqual(findMismatchRanges(tracks("ACGT")), []);
  });
});
