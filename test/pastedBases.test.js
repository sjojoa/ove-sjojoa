const assert = require("assert");
const { isStructured, rawBases } = require("../src/features/pastedBases");

describe("pasted text: is it bare bases?", () => {
  it("leaves formats that announce themselves to their own parsers", () => {
    assert.ok(isStructured(">seq\nacgt"));
    assert.ok(isStructured("LOCUS       pKR101   1200 bp"));
    assert.ok(isStructured("  locus       pKR101"));
    assert.ok(isStructured('{"sequence":"acgt"}'));
    assert.ok(isStructured("##gff-version 3"));
  });

  it("treats anything else as a candidate for bare bases", () => {
    assert.ok(!isStructured("acgtacgt"));
    assert.ok(!isStructured("[Tag]acgt[/Tag]"));
  });
});

describe("pasted text: reading bare bases", () => {
  it("accepts plain bases", () => {
    const r = rawBases("acgtACGT");
    assert.deepStrictEqual([r.ok, r.sequence, r.dropped], [true, "acgtACGT", 0]);
  });

  it("ignores the whitespace and line numbers a copied sequence carries", () => {
    const r = rawBases("   1 acgt acgt\n  10 ggttccaa\n");
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sequence, "acgtacgtggttccaa");
    assert.strictEqual(r.dropped, 0);
  });

  it("keeps ambiguity codes and alignment gaps", () => {
    assert.strictEqual(rawBases("acgtnryswkmbdhv-.").sequence, "acgtnryswkmbdhv-.");
  });

  it("refuses prose instead of importing its letters as a sequence", () => {
    const r = rawBases("Dear Santiago, please find the plasmid attached. Best regards,");
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /does not look like a sequence/);
    assert.match(r.reason, /% of the characters are not bases/);
  });

  it("refuses an empty paste", () => {
    assert.strictEqual(rawBases("   \n  ").ok, false);
    assert.strictEqual(rawBases("").reason, "nothing to read");
  });

  it("allows a few stray characters, and says how many it dropped", () => {
    // 36 bases and two strays: still obviously a sequence
    const r = rawBases(`${"acgt".repeat(9)}*!`);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.dropped, 2);
    assert.strictEqual(r.sequence, "acgt".repeat(9));
  });

  it("draws the line at one character in ten", () => {
    assert.strictEqual(rawBases(`${"acgt".repeat(5)}zzz`).ok, false); // 13% not bases
    assert.strictEqual(rawBases(`${"acgt".repeat(10)}zzz`).ok, true); // 7% not bases
  });
});
