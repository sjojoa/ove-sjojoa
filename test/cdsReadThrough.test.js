const assert = require("assert");
const { extendCds, cdsTranslations, isReadThroughBase } = require("../src/features/cdsReadThrough");

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

describe("one translation per reading frame", () => {
  // tag + linker + gene, all in frame, gene not terminated by its own annotation
  const TAG = { id: "tag", name: "AviTag", start: 0, end: 2, forward: true };
  const LINKER = { id: "linker", name: "GS_linker", start: 3, end: 8, forward: true };
  const GENE = { id: "gene", name: "SLC38A7", start: 9, end: 11, forward: true };

  it("merges features that share a reading frame into a single translation", () => {
    const out = cdsTranslations([GENE, TAG, LINKER], SEQ, false);
    const rows = Object.values(out);
    assert.strictEqual(rows.length, 1, "one protein, one row");
    assert.strictEqual(rows[0].start, 0, "starts at the 5'-most feature");
    assert.strictEqual(rows[0].end, 17, "ends on the shared stop codon");
  });

  it("names the merged row in reading order", () => {
    const out = cdsTranslations([GENE, TAG, LINKER], SEQ, false);
    assert.strictEqual(Object.values(out)[0].name, "AviTag \u2192 GS_linker \u2192 SLC38A7");
  });

  it("marks as read-through only what no feature annotates", () => {
    const out = cdsTranslations([TAG, LINKER, GENE], SEQ, false);
    const row = Object.values(out)[0];
    assert.deepStrictEqual(row.oveReadThrough, [{ start: 12, end: 17 }]);
    for (const i of [0, 5, 11]) assert.strictEqual(isReadThroughBase(row, i), false);
    for (const i of [12, 17]) assert.strictEqual(isReadThroughBase(row, i), true);
  });

  it("treats a gap between two features in the frame as read-through", () => {
    const out = cdsTranslations([TAG, GENE], SEQ, false); // nothing annotates 3..8
    const row = Object.values(out)[0];
    assert.deepStrictEqual(row.oveReadThrough, [
      { start: 3, end: 8 },
      { start: 12, end: 17 },
    ]);
  });

  it("keeps separate reading frames on separate rows", () => {
    // offset by one base, so this one cannot share a stop codon with the others
    const otherFrame = { id: "other", name: "shifted", start: 1, end: 6, forward: true };
    const out = cdsTranslations([TAG, otherFrame], SEQ, false);
    assert.strictEqual(Object.keys(out).length, 2);
  });

  it("keeps the two strands apart", () => {
    const out = cdsTranslations(
      [TAG, { id: "rev", name: "reverse", start: 0, end: 5, forward: false }],
      SEQ,
      false
    );
    assert.strictEqual(Object.keys(out).length, 2);
  });

  it("merges on the reverse strand too, extending downwards", () => {
    const rc = revcomp(SEQ);
    const downstream = { id: "d", name: "gene", start: 12, end: 17, forward: false };
    const upstream = { id: "u", name: "tag", start: 18, end: 23, forward: false };
    const rows = Object.values(cdsTranslations([downstream, upstream], rc, false));
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].end, 23, "still begins at the start codon");
    assert.strictEqual(rows[0].start, 6, "reaches the stop codon at 6..8");
    assert.strictEqual(rows[0].name, "tag \u2192 gene");
  });

  it("leaves a lone feature that needs no extension exactly as it was", () => {
    const complete = { id: "c", name: "cds", start: 0, end: 17, forward: true };
    const row = Object.values(cdsTranslations([complete], SEQ, false))[0];
    assert.strictEqual(row.start, 0);
    assert.strictEqual(row.end, 17);
    assert.strictEqual(row.oveReadThrough, undefined);
    assert.strictEqual(row.name, "cds", "a single feature keeps its own name");
  });

  it("returns nothing when there are no CDS features", () => {
    assert.deepStrictEqual(cdsTranslations([], SEQ, false), {});
  });
});
