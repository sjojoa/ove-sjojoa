const assert = require("assert");
const A = require("../src/alignment/localAligner.js");

const rc = (s) => s.split("").reverse().map((c) => ({ A: "T", T: "A", G: "C", C: "G" }[c] || c)).join("");

describe("aligning a read to a circular sequence", () => {
  // 240 bp of something with no long repeats
  const plasmid =
    "ATGCGTACGATCAGCTTAGCCATCAGGATCCTTAGCAAGTCCGATTACGGCATTACCGGTTAAGCTCAGGCATCAGCATTT" +
    "GGCCATTAGCAGTCAGCATCGGATCCATTAGCATCAGCTAGCTAACGGTCAGCTTACGCATTACGCATCAGCATTAGGCAT" +
    "CCGGATTACAGCATCAGGCATTACGCATCAGGCATTAGCAGTCAGCATCGGATTCATTAGCATCAGCTAGCTAACGGTAAC";

  it("lands a read that runs off the end back at base 1", () => {
    // 60 bases: the last 30 of the plasmid, then the first 30
    const read = plasmid.slice(-30) + plasmid.slice(0, 30);
    const res = A.alignCircular(plasmid, read);
    assert.strictEqual(res.wrapped, true);
    assert.strictEqual(res.readAligned.length, plasmid.length);
    // both ends of the row carry the read, the middle does not
    assert.strictEqual(res.readAligned.slice(0, 30), plasmid.slice(0, 30));
    assert.strictEqual(res.readAligned.slice(-30), plasmid.slice(-30));
    assert.ok(/^-+$/.test(res.readAligned.slice(30, -30)));
  });

  it("leaves a read that does not reach the seam alone", () => {
    const read = plasmid.slice(60, 140);
    const res = A.alignCircular(plasmid, read);
    assert.strictEqual(res.wrapped, false);
    assert.strictEqual(res.readAligned.slice(60, 140), read);
    assert.ok(/^-+$/.test(res.readAligned.slice(0, 60)));
  });

  it("handles a wrapping read on the other strand", () => {
    const read = rc(plasmid.slice(-40) + plasmid.slice(0, 40));
    const res = A.alignCircular(plasmid, read);
    assert.strictEqual(res.reversed, true);
    assert.strictEqual(res.wrapped, true);
    assert.strictEqual(res.readAligned.slice(0, 40), plasmid.slice(0, 40));
  });

  it("keeps a mismatch that sits across the seam", () => {
    const tail = plasmid.slice(-20);
    const head = plasmid.slice(0, 20).split("");
    head[5] = head[5] === "G" ? "T" : "G";
    const res = A.alignCircular(plasmid, tail + head.join(""));
    assert.strictEqual(res.readAligned[5], head[5]);
    assert.notStrictEqual(res.readAligned[5], plasmid[5]);
  });

  it("covers the whole sequence when the read is the whole plasmid, rotated", () => {
    const rotated = plasmid.slice(100) + plasmid.slice(0, 100);
    const res = A.alignCircular(plasmid, rotated);
    assert.strictEqual(res.readAligned.replace(/-/g, "").length, plasmid.length);
    assert.strictEqual(res.readAligned, plasmid);
  });
});

describe("an insertion in a read on a circular template", () => {
  const plasmid =
    "ATGCGTACGATCAGCTTAGCCATCAGGATCCTTAGCAAGTCCGATTACGGCATTACCGGTTAAGCTCAGGCATCAGCATTT" +
    "GGCCATTAGCAGTCAGCATCGGATCCATTAGCATCAGCTAGCTAACGGTCAGCTTACGCATTACGCATCAGCATTAGGCAT" +
    "CCGGATTACAGCATCAGGCATTACGCATCAGGCATTAGCAGTCAGCATCGGATTCATTAGCATCAGCTAGCTAACGGTAAC";
  const A = require("../src/alignment/localAligner.js");

  it("opens a gap in the plasmid row rather than being dropped", () => {
    // 80 bases from the middle with three extra bases spliced in
    const read = plasmid.slice(100, 140) + "GGG" + plasmid.slice(140, 180);
    const res = A.alignCircular(plasmid, read);
    assert.strictEqual(res.refAligned.length, plasmid.length + 3);
    assert.strictEqual(res.readAligned.length, res.refAligned.length);
    // the plasmid row has exactly the three inserted columns missing from it
    assert.strictEqual(res.refAligned.replace(/-/g, ""), plasmid);
    assert.ok(res.refAligned.includes("---"));
    // and the read's own bases survive
    assert.ok(res.readAligned.replace(/-/g, "").includes("GGG"));
  });

  it("reports where a read sits on the reference", () => {
    const read = plasmid.slice(100, 180);
    const res = A.alignCircular(plasmid, read);
    assert.strictEqual(res.refStart, 100);
    assert.strictEqual(res.refEnd, 179);
  });
});
