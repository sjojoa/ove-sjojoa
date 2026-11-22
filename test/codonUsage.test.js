const assert = require("assert");
const CU = require("../src/cloning/codonUsage.js");
const { CODON_TABLE } = require("../src/cloning/dnaTools.js");

describe("codon usage tables", () => {
  it("has a table per species, each with all 64 codons", () => {
    assert.ok(CU.SPECIES.length >= 8);
    CU.SPECIES.forEach((s) => {
      assert.strictEqual(Object.keys(s.codons).length, 64, s.id);
      Object.keys(s.codons).forEach((c) => assert.ok(CODON_TABLE[c], `${s.id} has unknown codon ${c}`));
    });
  });

  it("gives fractions per amino acid, so each amino acid's codons sum to 1", () => {
    CU.SPECIES.forEach((s) => {
      const sums = {};
      Object.keys(s.codons).forEach((c) => {
        sums[CODON_TABLE[c]] = (sums[CODON_TABLE[c]] || 0) + s.codons[c];
      });
      Object.keys(sums).forEach((aa) => assert.ok(Math.abs(sums[aa] - 1) < 0.02, `${s.id} ${aa} = ${sums[aa]}`));
    });
  });

  it("marks one favourite per amino acid", () => {
    const human = CU.byId("human");
    const best = CU.favourites(human.codons, CODON_TABLE);
    const aas = new Set(Object.keys(best).map((c) => CODON_TABLE[c]));
    assert.strictEqual(aas.size, 21); // 20 amino acids + stop
    // the single-codon amino acids are always their own favourite
    assert.ok(best.ATG && best.TGG);
    // human Leu prefers CTG, E. coli Arg prefers CGC
    assert.ok(best.CTG);
    assert.ok(CU.favourites(CU.byId("ecoli").codons, CODON_TABLE).CGC);
  });

  it("falls back to the first species for an unknown id", () => {
    assert.strictEqual(CU.byId("nope"), CU.SPECIES[0]);
  });
});
