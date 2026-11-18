const assert = require("assert");
const { correctFileName } = require("../src/main_utils/parseSequence.js");

const gb = "LOCUS       pTest        6705 bp ds-DNA circular\r\nFEATURES\r\n";
const snapgene = Buffer.from([0x09, 0x00, 0x00, 0x00, 0x0e, 0x53, 0x6e, 0x61, 0x70, 0x47]);

describe("a .dna file that is really GenBank text", () => {
  it("is renamed so bio-parsers reads it as GenBank", () => {
    assert.strictEqual(correctFileName(gb, "plasmid.dna"), "plasmid.dna.gb");
    assert.strictEqual(correctFileName(Buffer.from(gb), "plasmid.dna"), "plasmid.dna.gb");
  });

  it("leaves a real SnapGene file alone", () => {
    assert.strictEqual(correctFileName(snapgene, "plasmid.dna"), "plasmid.dna");
  });

  it("leaves a file that already says GenBank alone", () => {
    ["p.gb", "p.gbk", "p.GENBANK", "p.gp"].forEach((n) =>
      assert.strictEqual(correctFileName(gb, n), n)
    );
  });

  it("leaves other formats alone", () => {
    assert.strictEqual(correctFileName(">seq\nACGT", "p.fasta"), "p.fasta");
  });

  it("does not trip over a sequence that merely contains LOCUS", () => {
    assert.strictEqual(correctFileName("ACGTLOCUS ACGT", "p.dna"), "p.dna");
  });
});
