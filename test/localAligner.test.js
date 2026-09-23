const assert = require("assert");
const aligner = require("../src/alignment/localAligner");

function randomSeq(len, seed = 1) {
  // mulberry32 PRNG
  let a = seed >>> 0;
  let s = "";
  for (let i = 0; i < len; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    s += "ACGT"[((t ^ (t >>> 14)) >>> 0) & 3];
  }
  return s;
}

function checkMsa(rows, originals) {
  const len = rows[0].sequence.length;
  rows.forEach((row, i) => {
    assert.strictEqual(row.sequence.length, len, "all rows same length");
    assert.strictEqual(row.sequence.replace(/-/g, ""), originals[i], "row minus gaps equals input");
  });
}

function fakeChrom(seq) {
  const basePos = [...seq].map((_, i) => 5 + i * 10);
  const traceLen = seq.length * 10 + 10;
  const trace = (base) => {
    const t = new Array(traceLen).fill(0);
    [...seq].forEach((b, i) => { if (b === base) t[basePos[i]] = 1000 + i; });
    return t;
  };
  return {
    aTrace: trace("A"), cTrace: trace("C"), gTrace: trace("G"), tTrace: trace("T"),
    basePos, baseCalls: seq.split(""), qualNums: [...seq].map((_, i) => i % 60),
  };
}

describe("localAligner", function () {
  this.timeout(60000);
  const ref = randomSeq(5000, 7).toLowerCase();

  it("places a mutated forward read at the right position", () => {
    let read = ref.slice(1200, 2000).toUpperCase();
    read = read.slice(0, 100) + (read[100] === "A" ? "C" : "A") + read.slice(101); // SNP
    read = read.slice(0, 300) + read.slice(303); // 3bp deletion
    read = read.slice(0, 500) + "GG" + read.slice(500); // 2bp insertion
    const res = aligner.overlapAlign(ref, read);
    assert.strictEqual(res.readAligned.replace(/-/g, ""), read);
    assert.strictEqual(res.refAligned.replace(/-/g, ""), ref);
    assert.strictEqual(res.readAligned.search(/[^-]/), 1200, "read starts at ref 1200");
  });

  it("detects reverse-strand reads and flips the chromatogram", async () => {
    const fwd = ref.slice(3000, 3700).toUpperCase();
    const revRead = aligner.reverseComplement(fwd);
    const seqs = [
      { name: "ref", sequence: ref },
      { name: "fwdRead", sequence: ref.slice(100, 900).toUpperCase(), chromatogramData: fakeChrom(ref.slice(100, 900).toUpperCase()) },
      { name: "revRead", sequence: revRead, chromatogramData: fakeChrom(revRead) },
    ];
    const originals = seqs.map((s) => s.sequence);
    global.window = { toastr: { warning() {}, error(e) { throw new Error(e); } } };
    const out = await aligner.handleAlignment({ sequencesToAlign: seqs, isAlignToRefSeq: true });
    const rows = out.alignmentsToRefSeq;
    assert.ok(rows);
    // rev read is now stored reverse-complemented (= forward strand)
    assert.strictEqual(seqs[2].sequence, fwd);
    assert.ok(seqs[2].name.includes("rev-comp"));
    checkMsa(rows, [ref, originals[1], fwd]);
    assert.strictEqual(rows[2].sequence.search(/[^-]/), 3000);
    const chrom = seqs[2].chromatogramData;
    assert.strictEqual(chrom.baseCalls.join(""), fwd);
    assert.strictEqual(chrom.baseTraces.length, fwd.length);
    // each base's peak must sit in the trace of its called base
    chrom.baseCalls.forEach((b, i) => {
      const peak = Math.max(...chrom.baseTraces[i][b.toLowerCase() + "Trace"]);
      assert.ok(peak >= 1000, `peak for base ${i}`);
    });
    assert.strictEqual(rows[0].name.split("_")[0], "0");
    assert.strictEqual(rows[2].name.split("_")[0], "2");
  });

  it("merges insertions from several reads into one MSA", async () => {
    const r1 = ref.slice(400, 1000).slice(0, 200) + "TTTT" + ref.slice(600, 1000);
    const r2 = ref.slice(500, 1200).slice(0, 150) + "A" + ref.slice(650, 1200);
    const r3 = "ACGTACGTAC" + ref.slice(0, 300); // overhang before ref start
    const seqs = [ref, r1, r2, r3].map((s, i) => ({ name: "s" + i, sequence: s }));
    const out = await aligner.handleAlignment({ sequencesToAlign: seqs });
    checkMsa(out.alignedSequences, [ref, r1, r2, r3]);
  });

  it("returns synchronously (OVE does not await handleAlignment)", () => {
    const seqs = [ref, ref.slice(50, 400)].map((s, i) => ({ name: "s" + i, sequence: s }));
    const out = aligner.handleAlignment({ sequencesToAlign: seqs, isAlignToRefSeq: true });
    assert.ok(!(out instanceof Promise));
    assert.ok(out.alignmentsToRefSeq);
  });

  it("returns pairwise alignments", async () => {
    const reads = [ref.slice(10, 700), ref.slice(4000, 4900)];
    const seqs = [ref, ...reads].map((s, i) => ({ name: "s" + i, sequence: s }));
    const out = await aligner.handleAlignment({ sequencesToAlign: seqs, isPairwiseAlignment: true });
    assert.strictEqual(out.pairwiseAlignments.length, 2);
    out.pairwiseAlignments.forEach((pair, i) => checkMsa(pair, [ref, reads[i]]));
  });

  it("uses k-mer seeding on long references", async () => {
    const bigRef = randomSeq(80000, 3);
    const read = aligner.reverseComplement(bigRef.slice(61000, 62000));
    const seqs = [{ name: "big", sequence: bigRef }, { name: "r", sequence: read }];
    const t = Date.now();
    const out = await aligner.handleAlignment({ sequencesToAlign: seqs, isAlignToRefSeq: true });
    checkMsa(out.alignmentsToRefSeq, [bigRef, seqs[1].sequence]);
    assert.strictEqual(out.alignmentsToRefSeq[1].sequence.search(/[^-]/), 61000);
    assert.ok(Date.now() - t < 5000);
  });
});
