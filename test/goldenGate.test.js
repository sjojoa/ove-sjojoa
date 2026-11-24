const assert = require("assert");
const G = require("../src/cloning/goldenGate.js");

const end = (seq) => ({ type: "sticky5", seq });
const dead = { type: "end", seq: "" };
// a part as it comes out of its plasmid: the fragment you want, plus the
// backbone that carried it
const part = (name, left, right, size = 500) => ({
  name,
  candidates: [
    { left: end(left), right: end(right), size },
    { left: end(right), right: end(left), size: size * 4 }, // the carrier plasmid
  ],
});

describe("Golden Gate", () => {
  describe("finding the order", () => {
    // vector AATG -> promoter GGAG... a standard four-part assembly
    const parts = [
      { name: "vector", candidates: [{ left: end("CGCT"), right: end("GGAG"), size: 2000 }] },
      part("cds", "AATG", "GCTT"),
      part("promoter", "GGAG", "TACT"),
      part("terminator", "GCTT", "CGCT"),
      part("utr", "TACT", "AATG"),
    ];

    it("puts the parts in the one order their overhangs allow", () => {
      const order = G.chain(parts);
      assert.deepStrictEqual(order.map((s) => s.name), ["vector", "promoter", "utr", "cds", "terminator"]);
    });

    it("picks the part out of each plasmid rather than its backbone", () => {
      const order = G.chain(parts);
      order.slice(1).forEach((step) => assert.strictEqual(step.fragment.size, 500));
    });

    it("closes the circle back to the vector", () => {
      const order = G.chain(parts);
      const last = order[order.length - 1].fragment;
      assert.ok(G.joins(last.right, order[0].fragment.left));
    });

    it("returns nothing when a part's overhang has no partner", () => {
      const broken = parts.slice(0, 4).concat([part("utr", "TTTT", "AATG")]);
      assert.strictEqual(G.chain(broken), null);
    });

    it("names the overhang that leads nowhere", () => {
      // parts straight off a PCR, so there is no carrier backbone to pair with
      const only = (name, left, right) => ({ name, candidates: [{ left: end(left), right: end(right), size: 500 }] });
      const broken = [
        only("vector", "CGCT", "GGAG"),
        only("promoter", "GGAG", "TACT"),
        only("cds", "TTTT", "CGCT"), // should have started at TACT
      ];
      assert.strictEqual(G.chain(broken), null);
      assert.deepStrictEqual(G.unmatched(broken).map((u) => u.overhang), ["TACT"]);
    });
  });

  describe("overhangs that make a mixture", () => {
    it("flags an overhang used at more than one junction", () => {
      const order = [
        { name: "a", fragment: { left: end("AATG"), right: end("GGAG") } },
        { name: "b", fragment: { left: end("GGAG"), right: end("GGAG") } },
        { name: "c", fragment: { left: end("GGAG"), right: end("AATG") } },
      ];
      const found = G.problems(order);
      assert.ok(found.some((p) => /GGAG overhang is used at 2 junctions/.test(p.text)));
      assert.strictEqual(found[0].level, "danger");
    });

    it("flags a palindromic overhang, which lets a part go in backwards", () => {
      const order = [{ name: "a", fragment: { left: end("AATG"), right: end("GATC") } }];
      assert.ok(G.problems(order).some((p) => /its own reverse complement/.test(p.text)));
    });

    it("is quiet about a clean set of overhangs", () => {
      const order = [
        { name: "a", fragment: { left: end("AATG"), right: end("GGAG") } },
        { name: "b", fragment: { left: end("GGAG"), right: end("AATG") } },
      ];
      assert.deepStrictEqual(G.problems(order), []);
    });
  });

  it("ignores a fragment with an uncut end: it cannot sit inside a circle", () => {
    assert.strictEqual(G.usable({ left: dead, right: end("AATG") }), false);
    assert.strictEqual(G.usable({ left: end("AATG"), right: end("GGAG") }), true);
  });
});
