const assert = require("assert");
const C = require("../src/alignment/cloneCheck.js");
const aligner = require("../src/alignment/localAligner.js");

describe("checking a clone against its reads", () => {
  describe("one read", () => {
    it("reports the stretch of reference it covers", () => {
      const r = C.readReport({ refAligned: "ACGTACGTACGT", readAligned: "--GTACGT----" });
      assert.strictEqual(r.start, 2);
      assert.strictEqual(r.end, 7);
      assert.strictEqual(r.covered, 6);
      assert.strictEqual(r.identity, 100);
    });

    it("puts every mismatch in reference coordinates", () => {
      const r = C.readReport({ refAligned: "ACGTACGT", readAligned: "ACTTACGA" });
      assert.deepStrictEqual(r.mismatches, [
        { at: 2, ref: "G", read: "T" },
        { at: 7, ref: "T", read: "A" },
      ]);
      assert.strictEqual(Math.round(r.identity), 75);
    });

    it("counts an insertion once, however long", () => {
      // the read has GGG that the construct does not
      const r = C.readReport({ refAligned: "ACGT---ACGT", readAligned: "ACGTGGGACGT" });
      assert.strictEqual(r.insertions.length, 1);
      assert.deepStrictEqual(r.insertions[0], { at: 4, bases: "GGG" });
      assert.strictEqual(r.mismatches.length, 0);
    });

    it("counts a deletion once, however long", () => {
      const r = C.readReport({ refAligned: "ACGTTTTACGT", readAligned: "ACGT---ACGT" });
      assert.deepStrictEqual(r.deletions, [{ at: 4, length: 3 }]);
    });

    it("does not blame a read for the reference it never reached", () => {
      const r = C.readReport({ refAligned: "ACGTACGTACGT", readAligned: "----ACGT----" });
      assert.strictEqual(r.identity, 100);
      assert.strictEqual(r.mismatches.length, 0);
    });

    it("says nothing at all for an empty read", () => {
      const r = C.readReport({ refAligned: "ACGT", readAligned: "----" });
      assert.strictEqual(r.start, null);
      assert.strictEqual(r.covered, 0);
    });
  });

  describe("coverage", () => {
    it("finds the stretches no read reached", () => {
      const reports = [{ start: 0, end: 99 }, { start: 150, end: 199 }];
      const cov = C.coverage(reports, 200);
      assert.deepStrictEqual(cov.gaps, [{ start: 100, end: 149 }]);
      assert.strictEqual(cov.covered, 150);
      assert.strictEqual(cov.fraction, 0.75);
    });

    it("merges overlapping reads", () => {
      const cov = C.coverage([{ start: 0, end: 60 }, { start: 40, end: 99 }], 100);
      assert.deepStrictEqual(cov.gaps, []);
      assert.strictEqual(cov.fraction, 1);
    });
  });

  describe("what a change does to the protein", () => {
    // ATG GCT AAA TAA  = M A K *
    const seq = "ATGGCTAAATAA";
    const cds = { name: "gene", type: "CDS", start: 0, end: 11, forward: true };

    it("calls a silent change silent", () => {
      assert.strictEqual(C.consequence(seq, cds, 5, "A").kind, "silent"); // GCT -> GCA, still Ala
    });

    it("names the residue a missense change hits", () => {
      assert.strictEqual(C.consequence(seq, cds, 3, "C").text, "A2P"); // GCT -> CCT
    });

    it("spots a premature stop", () => {
      assert.strictEqual(C.consequence(seq, cds, 6, "T").kind, "nonsense"); // AAA -> TAA
    });

    it("says nothing about a change outside a CDS", () => {
      assert.strictEqual(C.consequence(seq, { name: "x", type: "misc_feature", start: 0, end: 11 }, 3, "C"), null);
      assert.strictEqual(C.consequence(seq, cds, 50, "C"), null);
    });
  });

  describe("the verdict", () => {
    it("is good only when the reads cover everything and agree", () => {
      const clean = [{ start: 0, end: 99, mismatches: [], insertions: [], deletions: [] }];
      assert.strictEqual(C.verdict(clean, 100).level, "success");
    });

    it("warns when the reads agree but leave the construct partly unread", () => {
      const partial = [{ start: 0, end: 49, mismatches: [], insertions: [], deletions: [] }];
      const v = C.verdict(partial, 100);
      assert.strictEqual(v.level, "warning");
      assert.ok(/50% covered/.test(v.text));
    });

    it("fails on any difference", () => {
      const bad = [{ start: 0, end: 99, mismatches: [{ at: 5 }], insertions: [], deletions: [] }];
      assert.strictEqual(C.verdict(bad, 100).level, "danger");
    });
  });

  it("works on a real alignment from the app's own aligner", () => {
    const construct = "GGCATTACGCTAGCTTAGGCATCGGATCCTTAGCGCATCAGCATCGGATCCATTAGCATCAGCTAGCTAACGGTCAGCTT";
    // a read off the middle, on the other strand, with one base wrong
    const slice = construct.slice(20, 60).replace(/^(.{10})./, "$1A");
    const rc = slice.split("").reverse().map((c) => ({ A: "T", T: "A", G: "C", C: "G" }[c])).join("");
    const aligned = aligner.alignBestStrand(construct, rc);
    const report = C.readReport({ ...aligned, name: "read1", reversed: aligned.reversed });
    assert.strictEqual(aligned.reversed, true);
    assert.strictEqual(report.start, 20);
    assert.ok(report.mismatches.length <= 1, JSON.stringify(report.mismatches));
    assert.ok(report.identity > 95);
  });
});
