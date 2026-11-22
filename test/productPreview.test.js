const assert = require("assert");
const P = require("../src/cloning/productPreview.js");

const vec = "A".repeat(50) + "GGCCTTAAGGCCTTAACGTA";   // 70 bp
const ins = "T".repeat(40) + "CCGGAATTCCGTAATTCAGG";   // 60 bp
const pieces = [{ name: "vec", sequence: vec }, { name: "ins", sequence: ins }];
const product = vec + ins;

describe("previewing an assembled product", () => {
  it("places each piece in the product", () => {
    assert.deepStrictEqual(P.layout(pieces), [
      { name: "vec", length: 70, start: 0, end: 69 },
      { name: "ins", length: 60, start: 70, end: 129 },
    ]);
  });

  describe("the junctions", () => {
    const joins = P.junctions({ pieces, sequence: product, overlap: 20, circular: true });

    it("closes the circle, so two pieces make two joins", () => {
      assert.strictEqual(joins.length, 2);
      assert.deepStrictEqual(joins.map((j) => `${j.after}>${j.before}`), ["vec>ins", "ins>vec"]);
    });

    it("takes the overlap from the end of the piece before it", () => {
      assert.strictEqual(joins[0].overlap, vec.slice(-20));
      assert.strictEqual(joins[0].at, 70);
    });

    it("wraps the last junction round the origin", () => {
      assert.strictEqual(joins[1].at, 0);
      assert.strictEqual(joins[1].overlap, ins.slice(-20));
      assert.strictEqual(joins[1].after3, vec.slice(0, 12), "reads on into the first piece");
    });

    it("shows the bases each parent contributes either side", () => {
      assert.strictEqual(joins[0].before5, vec.slice(38, 50));
      assert.strictEqual(joins[0].after3, ins.slice(0, 12));
    });

    it("leaves the last join open on a linear product", () => {
      const linear = P.junctions({ pieces, sequence: product, overlap: 20, circular: false });
      assert.strictEqual(linear.length, 1);
    });
  });

  describe("counting where an overlap occurs", () => {
    it("finds the one real occurrence", () => {
      assert.strictEqual(P.occurrences(product, vec.slice(-20), true), 1);
    });

    it("finds a repeat that could join the wrong pieces", () => {
      const repeated = vec + ins + vec.slice(-20);
      assert.strictEqual(P.occurrences(repeated, vec.slice(-20), false), 2);
    });

    it("finds an overlap that also occurs on the other strand", () => {
      const ov = "GGGGAAAATTTTCCCCAAAA";
      const seq = "A".repeat(20) + ov + "T".repeat(20) + P.revcomp(ov) + "C".repeat(20);
      assert.strictEqual(P.occurrences(seq, ov, false), 2);
    });

    it("counts a palindrome once, not twice", () => {
      const pal = "GGCCGGCCGGCCGGCCGGCC".slice(0, 12);
      const seq = "A".repeat(20) + P.revcomp(pal) + "T".repeat(20);
      assert.strictEqual(P.occurrences(seq, P.revcomp(pal), false), P.revcomp(pal) === pal ? 1 : 1);
    });
  });

  describe("what it warns about", () => {
    const join = { after: "a", before: "b", length: 20, gc: 50, occurrences: 1 };

    it("says nothing when the junction is sound", () => {
      assert.deepStrictEqual(P.problems([join]), []);
    });

    it("calls a repeated overlap a danger", () => {
      const [p] = P.problems([{ ...join, occurrences: 2 }]);
      assert.strictEqual(p.level, "danger");
      assert.match(p.text, /wrong order/);
    });

    it("calls a short overlap a danger", () => {
      const [p] = P.problems([{ ...join, length: 8 }], { minOverlap: 15 });
      assert.strictEqual(p.level, "danger");
    });

    it("warns about a cold overlap", () => {
      const [p] = P.problems([{ ...join, tm: 41 }]);
      assert.strictEqual(p.level, "warning");
      assert.match(p.text, /41\.0 °C/);
    });

    it("warns about an AT-rich overlap", () => {
      const [p] = P.problems([{ ...join, gc: 10 }]);
      assert.match(p.text, /10% GC/);
    });
  });

  describe("locating a junction by its overlap alone", () => {
    it("finds it when the overlap is unique", () => {
      const c = P.contextOf(product, vec.slice(-20), { circular: true });
      assert.strictEqual(c.at, 70);
      assert.strictEqual(c.after3, ins.slice(0, 12));
    });

    it("gives up when it is not", () => {
      assert.strictEqual(P.contextOf(vec.slice(-20) + "G" + vec.slice(-20), vec.slice(-20)), null);
    });
  });

  it("reports the product as a whole", () => {
    const s = P.summary({ pieces, sequence: product, circular: true });
    assert.strictEqual(s.length, 130);
    assert.deepStrictEqual(s.order, ["vec", "ins"]);
  });
});

describe("ligation junctions", () => {
  // vec | ins, joined by a 4 nt sticky end at each join. The overhang bases
  // live at the START of the right piece, not the end of the left one.
  const lPieces = [{ name: "vec", length: 70 }, { name: "ins", length: 60 }];
  const lJoins = [
    { overhang: ins.slice(0, 4), enzymes: ["EcoRI", "MfeI"] },
    { overhang: vec.slice(0, 4), enzymes: ["BamHI", "BglII"] },
  ];
  const joins = P.ligationJoins({ pieces: lPieces, joins: lJoins, sequence: product, circular: true, flank: 6 });

  it("puts the overhang at the first base of the right piece", () => {
    assert.strictEqual(joins[0].at, 70);
    assert.strictEqual(product.slice(70, 74), joins[0].overhang);
    assert.strictEqual(joins[0].before5, vec.slice(-6));
    assert.strictEqual(joins[0].after3, product.slice(74, 80));
  });

  it("closes the circle back to the first piece", () => {
    assert.strictEqual(joins[1].at, 0);
    assert.strictEqual(joins[1].after, "ins");
    assert.strictEqual(joins[1].before, "vec");
    assert.strictEqual(joins[1].before5, ins.slice(-6)); // reads round the origin
  });

  it("names both enzymes that made the junction", () => {
    assert.deepStrictEqual(joins[0].enzymes, ["EcoRI", "MfeI"]);
  });

  it("marks a blunt join as blunt", () => {
    const [j] = P.ligationJoins({
      pieces: lPieces,
      joins: [{ overhang: "", enzymes: ["EcoRV"] }, { overhang: "" }],
      sequence: product,
      circular: true,
      flank: 4,
    });
    assert.strictEqual(j.blunt, true);
    assert.strictEqual(j.overhang, "");
    assert.strictEqual(j.after3, product.slice(70, 74));
  });

  it("does not join the last piece back on a linear product", () => {
    const rows = P.ligationJoins({ pieces: lPieces, joins: lJoins, sequence: product, circular: false });
    assert.strictEqual(rows.length, 1);
  });
});

describe("PCR products", () => {
  const F = [{ start: 100, end: 119, mismatches: 0 }];
  const R = [{ start: 580, end: 599, mismatches: 0 }];

  it("gives the one product a specific pair makes", () => {
    const out = P.pcrProducts({ forwardSites: F, reverseSites: R, templateLength: 3000 });
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0], { start: 100, end: 599, size: 500, mismatches: 0 });
  });

  it("finds the extra band a second binding site makes, smallest first", () => {
    const out = P.pcrProducts({
      forwardSites: F,
      reverseSites: [...R, { start: 280, end: 299, mismatches: 2 }],
      templateLength: 3000,
    });
    assert.deepStrictEqual(out.map((p) => p.size), [200, 500]);
    assert.strictEqual(out[0].mismatches, 2);
  });

  it("ignores a reverse site behind the forward primer on a linear template", () => {
    const out = P.pcrProducts({ forwardSites: F, reverseSites: [{ start: 10, end: 29 }], templateLength: 3000 });
    assert.deepStrictEqual(out, []);
  });

  it("amplifies round the origin of a circular template", () => {
    const out = P.pcrProducts({
      forwardSites: [{ start: 2900, end: 2919 }],
      reverseSites: [{ start: 80, end: 99 }],
      templateLength: 3000,
      circular: true,
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].size, 200); // 2900..2999 then 0..99
  });

  it("drops a product too big to amplify", () => {
    const out = P.pcrProducts({ forwardSites: F, reverseSites: R, templateLength: 3000, maxSize: 200 });
    assert.deepStrictEqual(out, []);
  });
});
