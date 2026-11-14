const assert = require("assert");
const F = require("../src/cloning/fromPrimers.js");
const H = require("../src/features/primerHybridization.js");

const rc = (s) => H.reverseComplement(s);

// A template with enough sequence variety that a 20-mer from it is unique.
function makeTemplate(n, seed = 7) {
  const bases = "ACGT";
  let s = "";
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += bases[(x >> 16) % 4];
  }
  return s;
}

const T = makeTemplate(1200, 7);
const T2 = makeTemplate(900, 99);
const T3 = makeTemplate(700, 1234);

describe("building a construct from primers designed elsewhere (#20)", () => {
  describe("resolving one pasted primer", () => {
    it("finds where a forward primer sits", () => {
      const r = F.resolve(T, T.slice(100, 125), { prefer: "top" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.site.bottomStrand, false);
      assert.strictEqual(F.fivePrime(r.site), 100);
      assert.strictEqual(F.threePrime(r.site), 124);
    });

    it("finds where a reverse primer sits, and calls it the bottom strand", () => {
      const r = F.resolve(T, rc(T.slice(300, 325)), { prefer: "bottom" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.site.bottomStrand, true);
      assert.strictEqual(F.threePrime(r.site), 300);
      assert.strictEqual(F.fivePrime(r.site), 324);
    });

    it("reads a 5′ tail as a tail, not as mismatches", () => {
      const tail = "GGGGTACCGGATCC";
      const r = F.resolve(T, tail + T.slice(100, 125), { prefer: "top" });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.site.tail, tail);
      assert.strictEqual(r.site.mismatchCount, 0);
    });

    it("says so when a primer binds nowhere", () => {
      const r = F.resolve(T, "TTTTTTTTTTTTTTTTTTTTTTTTT", {});
      assert.strictEqual(r.ok, false);
      assert.ok(/no binding site|does not bind/.test(r.reason));
    });

    it("says so when a primer binds in more than one place", () => {
      const repeat = T.slice(200, 230);
      const doubled = T.slice(0, 600) + repeat + T.slice(600);
      const r = F.resolve(doubled, repeat, { prefer: "top" });
      assert.strictEqual(r.ok, true);
      assert.ok(r.ambiguous >= 2, `expected an ambiguity, got ${r.ambiguous}`);
    });
  });

  describe("the product of a pair", () => {
    it("is the stretch between them, with the primers' own bases at the ends", () => {
      const fwd = F.resolve(T, T.slice(100, 125), { prefer: "top" });
      const rev = F.resolve(T, rc(T.slice(400, 425)), { prefer: "bottom" });
      const p = F.amplify(T, fwd, rev, {});
      assert.strictEqual(p.sequence, T.slice(100, 425));
      assert.strictEqual(p.sequence.length, 325);
    });

    it("carries the tails into the product", () => {
      const ft = "GGATCCAAAA";
      const rt = "CTCGAGTTTT";
      const fwd = F.resolve(T, ft + T.slice(100, 125), { prefer: "top" });
      const rev = F.resolve(T, rt + rc(T.slice(400, 425)), { prefer: "bottom" });
      const p = F.amplify(T, fwd, rev, {});
      assert.strictEqual(p.sequence, ft + T.slice(100, 425) + rc(rt));
    });

    it("puts a mismatched primer base into the product, because that is the point", () => {
      // change one base near the 5' end of the forward primer's annealing region
      const anneal = T.slice(100, 125).split("");
      const was = anneal[2];
      anneal[2] = was === "A" ? "C" : "A";
      const fwd = F.resolve(T, anneal.join(""), { prefer: "top" });
      const rev = F.resolve(T, rc(T.slice(400, 425)), { prefer: "bottom" });
      assert.strictEqual(fwd.site.mismatchCount, 1);
      const p = F.amplify(T, fwd, rev, {});
      assert.strictEqual(p.sequence[2], anneal[2]);
      assert.notStrictEqual(p.sequence[2], was);
    });

    it("refuses a pair that faces the wrong way", () => {
      const fwd = F.resolve(T, T.slice(400, 425), { prefer: "top" });
      const rev = F.resolve(T, rc(T.slice(100, 125)), { prefer: "bottom" });
      const p = F.amplify(T, fwd, rev, {});
      assert.ok(p.error, "expected an error");
      assert.ok(/no product|upstream/.test(p.error));
    });

    it("refuses two primers that read along the same strand", () => {
      const a = F.resolve(T, T.slice(100, 125), { prefer: "top" });
      const b = F.resolve(T, T.slice(400, 425), { prefer: "top" });
      assert.ok(/same strand/.test(F.amplify(T, a, b, {}).error));
    });

    it("amplifies across the origin of a circular template", () => {
      const fwd = F.resolve(T, T.slice(1150, 1175), { isCircular: true, prefer: "top" });
      const rev = F.resolve(T, rc(T.slice(50, 75)), { isCircular: true, prefer: "bottom" });
      const p = F.amplify(T, fwd, rev, { isCircular: true });
      assert.strictEqual(p.sequence, T.slice(1150) + T.slice(0, 75));
    });
  });

  describe("mutagenesis from the pair you ordered", () => {
    // Q5-style: 5' ends back to back, reading outwards, forward primer
    // carrying the change
    function q5Pair(at, newBase) {
      const fwdAnneal = T.slice(at, at + 25).split("");
      fwdAnneal[0] = newBase;
      return {
        forward: fwdAnneal.join(""),
        reverse: rc(T.slice(at - 25, at)),
      };
    }

    it("reads the edit off the mismatch and builds the mutant", () => {
      const at = 500;
      const was = T[at];
      const to = was === "A" ? "G" : "A";
      const { forward, reverse } = q5Pair(at, to);
      const res = F.mutagenesis({ sequence: T, isCircular: true, forward, reverse });
      assert.deepStrictEqual(res.problems, []);
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.layout, "back-to-back");
      assert.deepStrictEqual(res.edits, [{ position: at + 1, from: was, to }]);
      assert.strictEqual(res.sequence.length, T.length, "a substitution does not change the length");
      assert.strictEqual(res.sequence[0], to, "the mutant is read from the forward primer's 5′ end");
    });

    it("gives back the same plasmid, rotated, when the primers change nothing", () => {
      const at = 500;
      const res = F.mutagenesis({
        sequence: T,
        isCircular: true,
        forward: T.slice(at, at + 25),
        reverse: rc(T.slice(at - 25, at)),
      });
      assert.strictEqual(res.sequence, T.slice(at) + T.slice(0, at));
      assert.ok(res.problems.some((p) => /rebuilds the same sequence/.test(p)));
    });

    it("handles a QuikChange pair, where both primers cover the same window", () => {
      // a real QuikChange primer is long, with the change in the middle and
      // enough clean sequence on the 3' side to anneal
      const at = 500;
      const was = T[at + 20];
      const to = was === "A" ? "G" : "A";
      const window = T.slice(at, at + 41).split("");
      window[20] = to;
      const fwd = window.join("");
      const res = F.mutagenesis({ sequence: T, isCircular: true, forward: fwd, reverse: rc(fwd) });
      assert.strictEqual(res.layout, "overlapping");
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.sequence.length, T.length);
      assert.strictEqual(res.sequence[at + 20], to);
      assert.strictEqual(res.sequence.slice(0, at), T.slice(0, at), "nothing outside the window moved");
    });

    it("says when the pair inserts bases rather than substituting them", () => {
      const at = 500;
      const res = F.mutagenesis({
        sequence: T,
        isCircular: true,
        forward: "GCGGCCGC" + T.slice(at, at + 25), // an added NotI site
        reverse: rc(T.slice(at - 25, at)),
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.lengthChange, 8);
      assert.deepStrictEqual(res.edits, [], "an insertion is not a list of substitutions");
      assert.ok(res.problems.some((p) => /changes the length by \+8 bp/.test(p)));
    });

    it("refuses a pair that is neither layout, rather than inventing a mutant", () => {
      const res = F.mutagenesis({
        sequence: T,
        isCircular: true,
        forward: T.slice(100, 125),
        reverse: rc(T.slice(400, 425)),
      });
      assert.strictEqual(res.ok, false);
      assert.ok(res.problems.some((p) => /neither back-to-back .* nor overlapping/.test(p)));
    });

    it("reports a primer that does not bind at all", () => {
      const res = F.mutagenesis({
        sequence: T,
        isCircular: true,
        forward: "TTTTTTTTTTTTTTTTTTTTTTTTT",
        reverse: rc(T.slice(475, 500)),
      });
      assert.strictEqual(res.ok, false);
      assert.ok(res.problems.some((p) => /Forward primer:/.test(p)));
    });
  });

  describe("Gibson from the pairs you ordered", () => {
    // Three fragments off three templates, joined by 20 nt overlaps, in the
    // order A -> B -> C -> A. Each forward primer carries the end of the
    // fragment before it as its 5' tail, which is how NEBuilder writes them.
    function assemblySet() {
      const aBody = T.slice(100, 400);
      const bBody = T2.slice(50, 300);
      const cBody = T3.slice(10, 260);
      // overlap before each fragment: last 20 nt of the fragment before
      const ovA = cBody.slice(-20); // C -> A
      const ovB = aBody.slice(-20); // A -> B
      const ovC = bBody.slice(-20); // B -> C
      return {
        fragments: [
          {
            name: "A",
            sequence: T,
            forward: ovA + T.slice(100, 125),
            reverse: ovB === aBody.slice(-20) ? rc(T.slice(375, 400)) : null,
          },
          { name: "B", sequence: T2, forward: ovB + T2.slice(50, 75), reverse: rc(T2.slice(275, 300)) },
          { name: "C", sequence: T3, forward: ovC + T3.slice(10, 35), reverse: rc(T3.slice(235, 260)) },
        ],
        bodies: { aBody, bBody, cBody },
      };
    }

    it("works out the order from the tails and builds the construct", () => {
      const { fragments, bodies } = assemblySet();
      const res = F.gibson({ fragments, circular: true });
      assert.deepStrictEqual(res.problems, []);
      assert.strictEqual(res.ok, true);
      assert.deepStrictEqual(res.order, ["A", "B", "C"]);
      // every base of every fragment, each overlap written once
      const expected = bodies.cBody.slice(-20) + bodies.aBody + bodies.bBody + bodies.cBody.slice(0, -20);
      assert.strictEqual(res.sequence.length, expected.length);
      assert.strictEqual(res.sequence, expected);
    });

    it("reports every junction with its overlap", () => {
      const res = F.gibson({ fragments: assemblySet().fragments, circular: true });
      assert.strictEqual(res.junctions.length, 3);
      res.junctions.forEach((j) => assert.strictEqual(j.length, 20));
      assert.deepStrictEqual(
        res.junctions.map((j) => `${j.after}->${j.before}`),
        ["A->B", "B->C", "C->A"]
      );
    });

    it("says which fragment's overlap matches nothing", () => {
      const { fragments } = assemblySet();
      fragments[1].forward = "GGGGGGGGGGGGGGGGGGGG" + T2.slice(50, 75); // a tail matching no end
      const res = F.gibson({ fragments, circular: true });
      assert.strictEqual(res.ok, false);
      assert.ok(res.problems.some((p) => /do not close a circle/.test(p)));
      assert.ok(res.problems.some((p) => /^B: its overlap/.test(p)));
    });

    it("warns about an overlap too short to assemble on", () => {
      const { fragments } = assemblySet();
      const shortOv = T3.slice(10, 260).slice(-8);
      fragments[0].forward = shortOv + T.slice(100, 125);
      const res = F.gibson({ fragments, circular: true });
      assert.ok(res.problems.some((p) => /8 nt, under the 15 nt/.test(p)));
    });

    it("reports a primer that does not bind its template", () => {
      const { fragments } = assemblySet();
      fragments[2].reverse = "TTTTTTTTTTTTTTTTTTTTTTTTT";
      const res = F.gibson({ fragments, circular: true });
      assert.strictEqual(res.ok, false);
      assert.ok(res.problems.some((p) => /^C, reverse primer:/.test(p)));
    });

    it("needs at least two fragments", () => {
      const res = F.gibson({ fragments: [assemblySet().fragments[0]], circular: true });
      assert.ok(res.problems.some((p) => /at least two fragments/.test(p)));
    });
  });
});
