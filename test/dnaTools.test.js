const assert = require("assert");
const fs = require("fs");
const path = require("path");
const bioParsers = require("bio-parsers");
const d = require("../src/cloning/dnaTools");

const GENE =
  "ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAAATTTTCTGTCAGTGGAGAGGGTGAAGGTGATGCTACATACGGAAAGCTTACCCTTAAATTTATTTGCACTACTGGAAAACTACCTGTTCCATGGCCAACACTTGTCACTACTTTCGGTTATGGTGTTCAATGCTTTGCGAGATACCCAGATCATATGAAACAGCATGACTTTTTCAAGAGTGCCATGCCCGAAGGTTATGTACAGGAAAGAACTATATTTTTCAAAGATGACGGGAACTACAAGACACGTGCTGAAGTCAAGTTTGAAGGTGATACCCTTGTTAATAGAATCGAGTTAAAAGGTATTGATTTTAAAGAAGATGGAAACATTCTTGGACACAAATTGGAATACAACTATAACTCACACAATGTATACATCATGGCAGACAAACAAAAGAATGGAATCAAAGTTAACTTCAAAATTAGACACAACATTGAAGATGGAAGCGTTCAACTAGCAGACCATTATCAACAAAATACTCCAATTGGCGATGGCCCTGTCCTTTTACCAGACAACCATTACCTGTCCACACAATCTGCCCTTTCGAAAGATCCCAACGAAAAGAGAGACCACATGGTCCTTCTTGAGTTTGTAACAGCTGCTGGGATTACACATGGCATGGATGAACTATACAAATAA";

let vector;
before(async () => {
  const gb = fs.readFileSync(path.join(__dirname, "..", "pA11990.gb"), "utf8");
  vector = (await bioParsers.anyToJson(gb, { fileName: "pA11990.gb" }))[0].parsedSequence;
});

const site = (name) => d.getEnzyme(name).site.toUpperCase();
function makeInsert(fivePrimeEnzyme, threePrimeEnzyme) {
  const s5 = site(fivePrimeEnzyme);
  const sequence = d.DEFAULT_LEADER + s5 + GENE + site(threePrimeEnzyme) + d.DEFAULT_LEADER;
  const start = d.DEFAULT_LEADER.length + s5.length;
  return {
    name: "GFP_insert",
    circular: false,
    sequence,
    features: [{ name: "GFP", type: "CDS", start, end: start + GENE.length - 1, forward: true }],
  };
}

describe("dnaTools: melting temperature", () => {
  it("matches Biopython Tm_NN (SantaLucia 1998 + Owczarzy 2008)", () => {
    const pcr = { Na: 50, Mg: 1.5, dNTPs: 0.8, primerNM: 250 };
    const naOnly = { Na: 50, Mg: 0, dNTPs: 0, primerNM: 500 };
    const refs = [
      ["AGCGGATAACAATTTCACACAGGA", 63.157, 57.8911],
      ["GTAAAACGACGGCCAGT", 58.121, 54.6881],
      ["ATGGCTAGCAAAGGAGAAGAA", 59.9344, 55.1885],
    ];
    for (const [seq, tPcr, tNa] of refs) {
      assert.ok(Math.abs(d.tm(seq, pcr) - tPcr) < 0.001, seq);
      assert.ok(Math.abs(d.tm(seq, naOnly) - tNa) < 0.001, seq);
    }
  });

  it("flags hairpins and 3′ self-dimers", () => {
    assert.ok(d.bestHairpin("GGGGCCCCAAAAGGGGCCCC").dG < -3);
    assert.strictEqual(d.bestHairpin("ACACACACACACACAC").dG, 0);
    const a = d.analyzeOligo("GCATATATATCCGGA");
    assert.ok(a.warnings.some((w) => w.includes("dinucleotide")));
  });
});

describe("dnaTools: primer design", () => {
  it("designs a Tm-matched pair at the exact region ends", () => {
    const [best] = d.designPrimers(GENE, false, { start: 0, end: GENE.length - 1 }, { targetTm: 60 });
    assert.ok(GENE.startsWith(best.forward.seq));
    assert.ok(d.revcomp(GENE).startsWith(best.reverse.seq));
    assert.ok(Math.abs(best.forward.tm - 60) < 3 && Math.abs(best.reverse.tm - 60) < 3);
    assert.strictEqual(best.productSize, GENE.length);
  });

  it("can place primers outside the region when flank > 0", () => {
    const template = "ATATATATATAT" + GENE + "TTTTTTTTTT";
    const pairs = d.designPrimers(template, false, { start: 12, end: 12 + GENE.length - 1 }, { flank: 12 });
    assert.ok(pairs[0].productSize >= GENE.length);
  });

  it("works across the origin of a circular template", () => {
    const circ = GENE.slice(300) + GENE.slice(0, 300);
    const start = circ.length - 300; // region wraps the origin
    const [best] = d.designPrimers(circ, true, { start, end: 399 }, {});
    assert.ok(best.forward.seq.length >= 18);
  });
});

describe("dnaTools: restriction cloning", () => {
  it("directional cloning gives only the forward product with intact annotations", () => {
    // pA11990 backbone runs XhoI (left) -> XbaI (right), so a forward insert needs XbaI 5′ / XhoI 3′
    const vfrags = d.digest(vector, ["XhoI", "XbaI"]);
    const backbone = vfrags.reduce((a, b) => (a.size > b.size ? a : b));
    const insert = makeInsert("XbaI", "XhoI");
    const ifrag = d.digest(insert, ["XbaI", "XhoI"]).reduce((a, b) => (a.size > b.size ? a : b));
    const { products, vectorSelfLigates } = d.restrictionClone({ vector, vectorFragment: backbone, insert, insertFragment: ifrag, name: "p-GFP" });
    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].orientation, "forward");
    assert.strictEqual(vectorSelfLigates, false);
    const prod = products[0].sequenceData;
    assert.strictEqual(prod.sequence.length, backbone.size + ifrag.size);
    assert.ok(prod.sequence.toUpperCase().includes(GENE));
    const gfp = prod.features.find((f) => f.name === "GFP");
    assert.strictEqual(prod.sequence.slice(gfp.start, gfp.end + 1).toUpperCase(), GENE);
    // vector features survive
    assert.ok(prod.features.length > 5);
  });

  it("wrongly oriented sites give the reverse product", () => {
    const vfrags = d.digest(vector, ["XhoI", "XbaI"]);
    const backbone = vfrags.reduce((a, b) => (a.size > b.size ? a : b));
    const insert = makeInsert("XhoI", "XbaI");
    const ifrag = d.digest(insert, ["XhoI", "XbaI"]).reduce((a, b) => (a.size > b.size ? a : b));
    const { products } = d.restrictionClone({ vector, vectorFragment: backbone, insert, insertFragment: ifrag, name: "p" });
    assert.deepStrictEqual(products.map((p) => p.orientation), ["reverse"]);
    assert.ok(products[0].sequenceData.sequence.toUpperCase().includes(d.revcomp(GENE)));
  });

  it("single-enzyme and blunt cloning allow both orientations; vector can self-ligate", () => {
    const vfrag = d.digest(vector, ["SmaI"])[0];
    const insert = { name: "blunt", circular: false, sequence: GENE };
    const ifrag = d.digest(insert, [])[0]; // uncut PCR product, blunt ends
    // uncut linear PCR product has "end" ends -> treat as blunt
    const bluntFrag = { ...ifrag, uncut: false, start: 0, end: GENE.length, left: { type: "blunt", seq: "" }, right: { type: "blunt", seq: "" } };
    const res = d.restrictionClone({ vector, vectorFragment: vfrag, insert, insertFragment: bluntFrag, name: "p" });
    assert.deepStrictEqual(res.products.map((p) => p.orientation), ["forward", "reverse"]);
    assert.strictEqual(res.vectorSelfLigates, true);
  });

  it("models 3′ overhangs (KpnI) and 5′ overhangs (XbaI)", () => {
    const f = d.digest({ sequence: "AAAAGGTACCTTTTTCTAGATTTT", circular: false }, ["KpnI", "XbaI"]);
    assert.strictEqual(f[1].left.type, "3'");
    assert.strictEqual(f[1].left.seq, "GTAC");
    assert.strictEqual(f[1].right.type, "5'");
    assert.strictEqual(f[1].right.seq, "CTAG");
  });
});

describe("dnaTools: mutagenesis", () => {
  const template = GENE;
  const applies = (res, start, end, newBases) => {
    const expected = template.slice(0, start) + newBases + template.slice(end + 1);
    assert.strictEqual(res.mutatedSequence, expected);
    // Q5: forward primer matches the mutated sequence; reverse primer's rc
    // ends exactly where the forward primer begins (back-to-back)
    const [f, r] = res.primers;
    const fPos = expected.indexOf(f.seq);
    assert.ok(fPos >= 0, "forward primer found in mutant");
    const rRc = d.revcomp(r.seq);
    const rPos = expected.indexOf(rRc);
    assert.ok(rPos >= 0, "reverse primer found in mutant");
    assert.strictEqual(rPos + rRc.length, fPos, "primers are back-to-back");
  };
  it("substitution", () => {
    const res = d.designMutagenesis(template, false, { start: 99, end: 101, newBases: "GCC" }, {});
    applies(res, 99, 101, "GCC");
  });
  it("deletion", () => {
    const res = d.designMutagenesis(template, false, { start: 200, end: 229, newBases: "" }, {});
    applies(res, 200, 229, "");
  });
  it("insertion (HA tag)", () => {
    const ha = "TACCCATACGATGTTCCAGATTACGCT";
    // right after the ATG of a gene in a circular plasmid: reverse primer wraps the origin
    const res = d.designMutagenesis(template, true, { start: 3, end: 2, newBases: ha }, {});
    const expected = template.slice(0, 3) + ha + template.slice(3);
    assert.strictEqual(res.mutatedSequence, expected);
    const [f, r] = res.primers;
    const fPos = expected.indexOf(f.seq);
    assert.strictEqual(fPos, 3 + 13); // long insert split: second half on the forward primer
    // back-to-back around the circle: rc(reverse primer) ends where the forward primer starts
    const rRc = d.revcomp(r.seq);
    const doubled = expected + expected;
    const rPos = doubled.indexOf(rRc, expected.length - rRc.length);
    assert.ok(rPos >= 0, "reverse primer found in circular mutant");
    assert.strictEqual((rPos + rRc.length) % expected.length, fPos);
  });
  it("explains when a linear template has no room for a primer", () => {
    assert.throws(() => d.designMutagenesis(template, false, { start: 3, end: 2, newBases: "GGG" }, {}), /Not enough template/);
  });
  it("QuikChange primers are complementary and contain the mutation", () => {
    const res = d.designMutagenesis(template, false, { start: 150, end: 150, newBases: "A" }, { method: "quikchange" });
    const [f, r] = res.primers;
    assert.strictEqual(r.seq, d.revcomp(f.seq));
    assert.ok(res.mutatedSequence.includes(f.seq));
    assert.ok(f.seq.length >= 25 && f.seq.length <= 45);
  });
  it("chooses codons with the fewest changes", () => {
    assert.strictEqual(d.CODON_TABLE[d.chooseCodon("GAT", "A")], "A");
    // GAA and GAG are both 1 change away; ties go to the host's preferred codon
    assert.strictEqual(d.chooseCodon("GAT", "E", "human"), "GAG");
    assert.strictEqual(d.chooseCodon("GAT", "E", "ecoli"), "GAA");
  });
  it("mutateSeqData keeps features", () => {
    const sd = { sequence: template, features: [{ name: "GFP", start: 0, end: template.length - 1, forward: true }] };
    const out = d.mutateSeqData(sd, { start: 99, end: 101, newBases: "GCC" });
    assert.strictEqual(out.sequence.slice(99, 102), "GCC");
    assert.strictEqual(out.features[0].end, template.length - 1);
  });
});

describe("dnaTools: Gibson assembly", () => {
  it("adds overlaps from neighbouring pieces to insert primers", () => {
    const vec = { name: "vec", sequence: "GATCGATCGGCTAGCTAGCTTTACGGATCCAAAGGCCTTGGAACCTTGGACTG", circular: false };
    const ins = { name: "ins", sequence: GENE };
    const res = d.designGibson([{ seqData: vec }, { seqData: ins }], { overlap: 20 });
    const [f, r] = res.pieces[1].primers;
    assert.strictEqual(f.seq.slice(0, 20).toUpperCase(), vec.sequence.slice(-20));
    assert.strictEqual(d.revcomp(r.seq.slice(0, 20).toUpperCase()), vec.sequence.slice(0, 20));
    assert.strictEqual(res.construct.sequence.length, vec.sequence.length + GENE.length);
    assert.strictEqual(res.construct.circular, true);
    const label = res.construct.features.find((f) => f.name === "ins");
    assert.strictEqual(res.construct.sequence.slice(label.start, label.end + 1), GENE);
  });
});

describe("dnaTools: gels", () => {
  it("larger fragments migrate less", () => {
    assert.ok(d.migration(500, 1) > d.migration(5000, 1));
    // small fragments are resolved better on high-percentage gels
    const sep = (pct) => d.migration(100, pct) - d.migration(200, pct);
    assert.ok(sep(2) > sep(0.7));
  });
  it("digest lanes sum to the plasmid size", () => {
    const bands = d.laneBands(vector, ["XhoI", "XbaI"]);
    assert.strictEqual(bands.reduce((s, b) => s + b.size, 0), vector.sequence.length);
  });
});
