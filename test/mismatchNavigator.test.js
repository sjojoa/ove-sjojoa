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

describe("mismatchNavigator: describeMismatch", () => {
  const { describeMismatch } = require("../src/alignment/mismatchNavigator");
  // ref: 3 bp spacer + CDS ATG AAA GAA TGG TAA (M K E W *) + spacer
  const ref = "CCC" + "ATGAAAGAATGGTAA" + "CCC";
  const fwd = { name: "geneF", type: "CDS", start: 3, end: 17, forward: true };
  const mk = (refAln, readAln, features) => [
    { alignmentData: { sequence: refAln }, sequenceData: { sequence: ref, features } },
    { alignmentData: { sequence: readAln }, sequenceData: { name: "read" } },
  ];
  it("names the amino-acid change of a substitution in a forward CDS", () => {
    const read = ref.slice(0, 7) + "G" + ref.slice(8); // AAA -> AGA : K2R (c.5A>G)
    const d = describeMismatch(mk(ref, read, [fwd]), { start: 7, end: 7 });
    assert.deepStrictEqual(d.features, ["geneF (CDS): c.5A>G · p.Lys2Arg"]);
    assert.strictEqual(d.where, "ref 8");
  });
  it("handles reverse-strand CDS", () => {
    // gene on the bottom strand: top strand holds its reverse complement
    const gene = "ATGAAAGAATGGTAA";
    const rcg = gene.split("").reverse().map((c) => ({ A: "T", T: "A", G: "C", C: "G" })[c]).join("");
    const r2 = "CCC" + rcg + "CCC";
    const rev = { name: "geneR", type: "CDS", start: 3, end: 17, forward: false };
    // mutate c.5 (A in AAA codon 2) -> G ; on top strand that is position 17 - 4 = 13, base T -> C
    const read = r2.slice(0, 13) + "C" + r2.slice(14);
    const tracks = [
      { alignmentData: { sequence: r2 }, sequenceData: { sequence: r2, features: [rev] } },
      { alignmentData: { sequence: read }, sequenceData: { name: "read" } },
    ];
    const d = describeMismatch(tracks, { start: 13, end: 13 });
    assert.deepStrictEqual(d.features, ["geneR (CDS): c.5A>G · p.Lys2Arg"]);
  });
  it("calls silent, nonsense and frameshift changes", () => {
    const silent = ref.slice(0, 8) + "G" + ref.slice(9); // AAA->AAG
    assert.match(describeMismatch(mk(ref, silent, [fwd]), { start: 8, end: 8 }).features[0], /p\.Lys2= \(silent\)/);
    const stop = ref.slice(0, 14) + "A" + ref.slice(15); // TGG->TGA
    assert.match(describeMismatch(mk(ref, stop, [fwd]), { start: 14, end: 14 }).features[0], /p\.Trp4Ter \(nonsense\)/);
    const del = ref.slice(0, 7) + "-" + ref.slice(8);
    assert.match(describeMismatch(mk(ref, del, [fwd]), { start: 7, end: 7 }).features[0], /frameshift \(-1 bp\)/);
    const del3 = ref.slice(0, 6) + "---" + ref.slice(9);
    assert.match(describeMismatch(mk(ref, del3, [fwd]), { start: 6, end: 8 }).features[0], /in-frame deletion of 1 aa/);
  });
  it("reports when a mismatch is outside every feature", () => {
    const read = "A" + ref.slice(1);
    assert.deepStrictEqual(describeMismatch(mk(ref, read, [fwd]), { start: 0, end: 0 }).features, []);
  });
});
