const assert = require("assert");
const {
  findSites,
  alignment,
  describe: describeSite,
  reverseComplement,
  DEFAULT_PARAMS,
} = require("../src/features/primerHybridization");

// 300 bp of non-repetitive template, so a 15+ base stretch is unique in it
const T = (
  "GGCATGAGGGCGGCGGTGGTAGCGCCGGTGGCGGTGGCAGCATGGGCAGCAGCCATCATTACGATCACAGCAGC" +
  "GGCCTGGTGCCGCGCGGCAGCCATATGAAATTCGAACTGGTCGAGTCGAGCTTTCCGGATCCAGTTAAGCTTAC" +
  "CGTGCAAGATTTCTACGGTAAACCGTCCATTCTGGAAAACGGTAAATTAGTGGACCTTCAGATTCTGCGTGAAT" +
  "TTGCCGTATAGCACCGTTTAACCATGGTCTAGAGGTACCCTGCAGGAATTCACTAGTCCCGGGTTAACGCGTAC"
).toUpperCase();

const params = (over) => Object.assign({}, DEFAULT_PARAMS, over);

describe("primer hybridisation: finding binding sites", () => {
  it("places a plain primer on the top strand", () => {
    const primer = T.slice(40, 62);
    const r = findSites(T, primer, {});
    assert.strictEqual(r.reason, null);
    assert.strictEqual(r.sites.length, 1);
    const s = r.sites[0];
    assert.deepStrictEqual([s.start, s.end], [40, 61]);
    assert.strictEqual(s.bottomStrand, false);
    assert.strictEqual(s.annealLength, 22);
    assert.strictEqual(s.tailLength, 0);
    assert.strictEqual(s.mismatchCount, 0);
  });

  it("places a primer found on the bottom strand, with its 3' end at the low coordinate", () => {
    // a reverse primer reads right-to-left on the map, so the base a
    // polymerase extends from is the leftmost one
    const primer = reverseComplement(T.slice(100, 124));
    const r = findSites(T, primer, {});
    assert.strictEqual(r.sites.length, 1);
    const s = r.sites[0];
    assert.deepStrictEqual([s.start, s.end], [100, 123]);
    assert.strictEqual(s.bottomStrand, true);
    assert.strictEqual(s.threePrimeEnd, 100);
  });

  it("treats a 5' tail as a tail, not as mismatches", () => {
    const primer = "GGATCCGAATTC" + T.slice(150, 172);
    const r = findSites(T, primer, {});
    assert.strictEqual(r.sites.length, 1);
    const s = r.sites[0];
    assert.strictEqual(s.annealLength, 22);
    assert.strictEqual(s.tail, "GGATCCGAATTC");
    assert.deepStrictEqual([s.start, s.end], [150, 171]);
    assert.strictEqual(s.mismatchCount, 0);
  });

  it("places a tail far longer than the annealing region (a Gibson overlap)", () => {
    const overlap = "CAGTCTGACTGACATTAGCCGTTAGCAG";
    const primer = overlap + T.slice(200, 222);
    const r = findSites(T, primer, {});
    assert.strictEqual(r.sites.length, 1);
    const s = r.sites[0];
    assert.strictEqual(s.threePrimeEnd, 221);
    assert.ok(s.annealLength >= 22);
    assert.strictEqual(s.annealLength + s.tailLength, primer.length);
    assert.strictEqual(s.mismatchCount, 0);
  });

  it("counts tail bases that happen to pair as part of the annealing region", () => {
    // the boundary between tail and annealing region is where pairing stops,
    // which is all that can be known from the sequences: a tail base sitting
    // over its own complement is paired whatever it was put there for. It
    // moves the reported boundary, never the site or the product.
    const anneal = T.slice(200, 222);
    // one tail base that pairs (it equals the template base just 5' of the
    // site), the rest of the tail deliberately not pairing
    const junction = T[199];
    const filler = T[198] === "C" ? "AAAAAA" : "CCCCCC";
    const r = findSites(T, filler + junction + anneal, {});
    assert.strictEqual(r.sites[0].annealLength, 23);
    assert.strictEqual(r.sites[0].tailLength, 6);
  });

  it("allows one isolated mismatch 5' of the protected 3' end", () => {
    const bases = T.slice(40, 65).split("");
    bases[2] = bases[2] === "A" ? "C" : "A"; // 23 bases from the 3' end
    const r = findSites(T, bases.join(""), {});
    assert.strictEqual(r.sites.length, 1);
    const s = r.sites[0];
    assert.strictEqual(s.mismatchCount, 1);
    assert.strictEqual(s.mismatches[0].templateIndex, 42);
    assert.strictEqual(s.annealLength, 25);
  });

  it("refuses the same mismatch when the isolated-mismatch allowance is off", () => {
    const bases = T.slice(40, 65).split("");
    bases[2] = bases[2] === "A" ? "C" : "A";
    const r = findSites(T, bases.join(""), { params: params({ allowIsolatedMismatch: false }) });
    // the 3' side of the mismatch still matches over 22 bases, so the site is
    // still found — only shorter, with the mismatch left in the tail
    assert.strictEqual(r.sites.length, 1);
    assert.strictEqual(r.sites[0].mismatchCount, 0);
    assert.strictEqual(r.sites[0].annealLength, 22);
  });

  it("rejects a site whose 3' terminal bases do not pair", () => {
    const bases = T.slice(40, 65).split("");
    bases[bases.length - 2] = bases[bases.length - 2] === "A" ? "C" : "A";
    const r = findSites(T, bases.join(""), {});
    assert.deepStrictEqual(r.sites, []);
    assert.ok(/no binding site/.test(r.reason));
  });

  it("will not call two adjacent mismatches isolated", () => {
    const bases = T.slice(40, 65).split("");
    bases[2] = bases[2] === "A" ? "C" : "A";
    bases[3] = bases[3] === "A" ? "C" : "A";
    const r = findSites(T, bases.join(""), {});
    assert.strictEqual(r.sites.length, 1);
    // the pair stops the match, so only the 3' side of them anneals
    assert.strictEqual(r.sites[0].mismatchCount, 0);
    assert.strictEqual(r.sites[0].annealLength, 21);
  });

  it("honours the 3' match length, so a short anneal stops being a site", () => {
    const primer = "CCCCCCCCCCCCCCCCCCCC" + T.slice(60, 76); // 16 nt anneal
    assert.strictEqual(findSites(T, primer, { params: params({ minTm: 0 }) }).sites.length, 1);
    assert.strictEqual(
      findSites(T, primer, { params: params({ minMatch3Prime: 20, minTm: 0 }) }).sites.length,
      0
    );
  });

  it("drops a site whose annealing region melts below the Tm floor", () => {
    const primer = T.slice(60, 76); // 16 nt, AT-rich enough to sit near 50 °C
    const low = findSites(T, primer, { params: params({ minTm: 0 }) });
    assert.strictEqual(low.sites.length, 1);
    assert.ok(Number.isFinite(low.sites[0].tm));
    const high = findSites(T, primer, {
      params: params({ minTm: low.sites[0].tm + 5 }),
    });
    assert.strictEqual(high.sites.length, 0);
  });

  it("reports every site, best first, when a primer binds more than once", () => {
    const repeated = T.slice(40, 62);
    const twice = T + repeated + T.slice(0, 20);
    const r = findSites(twice, repeated, {});
    assert.strictEqual(r.sites.length, 2);
    assert.ok(r.sites.every((s) => s.mismatchCount === 0));
    assert.ok(r.sites[0].start < r.sites[1].start);
  });

  it("ranks an exact site above a mismatched one and a longer one above a shorter", () => {
    const bases = T.slice(40, 65).split("");
    bases[2] = bases[2] === "A" ? "C" : "A";
    const mismatched = bases.join("");
    // a second copy of the template that matches the primer exactly, so one
    // site is perfect and the original is the mismatched one
    const withSecondCopy = T + mismatched;
    const r = findSites(withSecondCopy, mismatched, {});
    assert.ok(r.sites.length >= 2);
    assert.strictEqual(r.sites[0].mismatchCount, 0);
    assert.strictEqual(r.sites[0].start, T.length);
  });

  it("finds a site that wraps the origin of a circular template", () => {
    const primer = T.slice(-10) + T.slice(0, 12);
    assert.strictEqual(findSites(T, primer, { isCircular: false }).sites.length, 0);
    const r = findSites(T, primer, { isCircular: true });
    assert.strictEqual(r.sites.length, 1);
    assert.strictEqual(r.sites[0].start, T.length - 10);
    assert.strictEqual(r.sites[0].end, 11);
  });

  it("says why nothing was found when the primer is shorter than the 3' requirement", () => {
    const r = findSites(T, T.slice(40, 50), {});
    assert.deepStrictEqual(r.sites, []);
    assert.ok(/shorter than/.test(r.reason));
  });

  it("ignores whitespace, digits and case in the pasted bases", () => {
    const messy = "  1 " + T.slice(40, 62).toLowerCase().replace(/(.{5})/g, "$1 ") + "\n";
    const r = findSites(T, messy, {});
    assert.strictEqual(r.sites.length, 1);
    assert.strictEqual(r.sites[0].annealLength, 22);
  });

  it("matches an N in the primer against anything", () => {
    const bases = T.slice(40, 65).split("");
    bases[2] = "N";
    const r = findSites(T, bases.join(""), {});
    assert.strictEqual(r.sites.length, 1);
    assert.strictEqual(r.sites[0].mismatchCount, 0);
    assert.strictEqual(r.sites[0].annealLength, 25);
  });

  it("finds 5'-only sites only when asked, and marks them as non-extending", () => {
    // a primer whose 5' half matches here and whose 3' half matches nothing
    const primer = T.slice(40, 58) + "CCCCCGGGGGCCCCCGGGGG";
    assert.strictEqual(findSites(T, primer, {}).sites.length, 0);
    const r = findSites(T, primer, { params: params({ show5PrimeOnly: true }) });
    assert.strictEqual(r.sites.length, 1);
    assert.strictEqual(r.sites[0].fivePrimeOnly, true);
    assert.strictEqual(r.sites[0].annealLength, 18);
    assert.ok(/will not extend/.test(describeSite(r.sites[0])));
  });

  it("never ranks a 5'-only site above a real one", () => {
    const primer = "GGATCCGAATTC" + T.slice(150, 172);
    const r = findSites(T, primer, { params: params({ show5PrimeOnly: true, minMatch5Prime: 8 }) });
    assert.strictEqual(r.sites[0].fivePrimeOnly, false);
  });
});

describe("primer hybridisation: per-base alignment", () => {
  it("marks tail, match and mismatch separately", () => {
    const bases = T.slice(40, 65).split("");
    bases[4] = bases[4] === "A" ? "C" : "A";
    const primer = "GGATCC" + bases.join("");
    const r = findSites(T, primer, {});
    const a = alignment(r.sites[0], primer, T);
    assert.strictEqual(a.length, primer.length);
    assert.deepStrictEqual(
      a.slice(0, 6).map((x) => x.state),
      ["tail", "tail", "tail", "tail", "tail", "tail"]
    );
    assert.strictEqual(a[10].state, "mismatch");
    assert.strictEqual(a[11].state, "match");
    assert.strictEqual(a[a.length - 1].state, "match");
  });

  it("pairs each annealing base with the template base underneath it, top strand", () => {
    const primer = "AAAA" + T.slice(40, 62);
    const a = alignment(findSites(T, primer, {}).sites[0], primer, T);
    a.forEach((x, i) => {
      if (x.state === "tail") {
        assert.strictEqual(x.templateIndex, null);
      } else {
        assert.strictEqual(x.templateIndex, 40 + i - 4);
        // the primer sits on the top strand, so it pairs with the bottom one
        assert.notStrictEqual(x.partner, x.base);
      }
    });
  });

  it("pairs each annealing base with the template base underneath it, bottom strand", () => {
    const primer = "AAAA" + reverseComplement(T.slice(100, 124));
    const a = alignment(findSites(T, primer, {}).sites[0], primer, T);
    const annealing = a.filter((x) => x.state !== "tail");
    assert.ok(annealing.length >= 24);
    // the primer's 3'-most base sits at the low coordinate and the annealing
    // region runs rightwards from it, because a reverse primer reads leftwards
    assert.strictEqual(annealing[annealing.length - 1].templateIndex, 100);
    assert.strictEqual(annealing[0].templateIndex, 100 + annealing.length - 1);
  });
});

describe("primer hybridisation: reverse complement", () => {
  it("flips a primer and leaves it findable the other way round", () => {
    const primer = T.slice(40, 62);
    const flipped = reverseComplement(primer);
    assert.strictEqual(reverseComplement(flipped), primer);
    assert.strictEqual(findSites(T, flipped, {}).sites[0].bottomStrand, true);
  });
});
