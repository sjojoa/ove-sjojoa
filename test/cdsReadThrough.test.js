const assert = require("assert");
const { extendCds, isReadThroughBase } = require("../src/features/cdsReadThrough");

const revcomp = (s) =>
  s.split("").reverse().map((c) => ({ A: "T", T: "A", G: "C", C: "G" }[c] || c)).join("");

//         0  3  6  9  12 15 18
// bases   ATG AAA AAA AAA GGG TAA CCCCCC
const SEQ = "ATGAAAAAAAAAGGGTAACCCCCC";

describe("CDS read-through translation", () => {
  it("carries the translation on to the next in-frame stop codon", () => {
    const out = extendCds({ start: 0, end: 11, forward: true }, SEQ, false);
    assert.deepStrictEqual(out, {
      start: 0,
      end: 17, // through the TAA at 15..17, stop codon included
      oveReadThrough: { start: 12, end: 17 },
    });
  });

  it("leaves a feature that already ends in a stop codon alone", () => {
    assert.strictEqual(extendCds({ start: 0, end: 17, forward: true }, SEQ, false), null);
  });

  it("completes a codon the feature cuts in half", () => {
    // ends mid-codon at 13, so the frame set by the start codon continues
    const out = extendCds({ start: 0, end: 13, forward: true }, SEQ, false);
    assert.strictEqual(out.end, 17);
    assert.strictEqual(out.oveReadThrough.start, 14);
  });

  it("extends downwards on the reverse strand", () => {
    const rc = revcomp(SEQ); // start codon now at the far end, reading right to left
    const out = extendCds({ start: 12, end: 23, forward: false }, rc, false);
    assert.strictEqual(out.end, 23, "the feature's own end must not move");
    assert.strictEqual(out.start, 6, "stop codon on the bottom strand sits at 6..8");
    assert.deepStrictEqual(out.oveReadThrough, { start: 6, end: 11 });
  });

  it("reads past the origin of a circular sequence", () => {
    const circ = "TAA" + "GGG".repeat(5) + "ATGAAA"; // 24 bp, CDS at the very end
    const out = extendCds({ start: 18, end: 23, forward: true }, circ, true);
    assert.strictEqual(out.start, 18);
    assert.strictEqual(out.end, 2, "wraps the origin and ends on the TAA at 0..2");
    assert.deepStrictEqual(out.oveReadThrough, { start: 0, end: 2 });
  });

  it("runs to the end of a linear sequence when no stop codon follows", () => {
    const noStop = "ATG" + "AAA".repeat(7); // 24 bp, never terminates
    const out = extendCds({ start: 0, end: 11, forward: true }, noStop, false);
    assert.strictEqual(out.end, 23);
  });

  it("does not lap a circular sequence that has no stop codon in frame", () => {
    const noStop = "ATG" + "AAA".repeat(7);
    assert.strictEqual(extendCds({ start: 0, end: 11, forward: true }, noStop, true), null);
  });

  it("leaves joined (multi-segment) features alone", () => {
    const joined = { start: 0, end: 11, forward: true, locations: [{ start: 0, end: 5 }, { start: 8, end: 11 }] };
    assert.strictEqual(extendCds(joined, SEQ, false), null);
  });

  it("ignores features too short to hold a codon", () => {
    assert.strictEqual(extendCds({ start: 0, end: 1, forward: true }, SEQ, false), null);
  });

  it("reads strand from `strand` when `forward` is absent", () => {
    const out = extendCds({ start: 0, end: 11, strand: 1 }, SEQ, false);
    assert.strictEqual(out.end, 17);
  });

  it("marks only the inferred bases as read-through", () => {
    const ann = { oveReadThrough: { start: 12, end: 17 } };
    assert.strictEqual(isReadThroughBase(ann, 11, 24), false);
    assert.strictEqual(isReadThroughBase(ann, 12, 24), true);
    assert.strictEqual(isReadThroughBase(ann, 17, 24), true);
    assert.strictEqual(isReadThroughBase(ann, 18, 24), false);
    assert.strictEqual(isReadThroughBase({}, 12, 24), false);
  });

  it("marks read-through bases across the origin", () => {
    const ann = { oveReadThrough: { start: 22, end: 2 } };
    assert.strictEqual(isReadThroughBase(ann, 23, 24), true);
    assert.strictEqual(isReadThroughBase(ann, 0, 24), true);
    assert.strictEqual(isReadThroughBase(ann, 3, 24), false);
  });
});
