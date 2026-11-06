const assert = require("assert");
const { bindPrimer, virtualPrimer } = require("../src/features/primerBinding");
const { reverseComplement } = require("../src/features/mismatchSearch");

// a template with distinguishable stretches
const T =
  "GGCATGAGGGCGGCGGTGGTAGCGCCGGTGGCGGTGGCAGCATGGGCAGCAGCCATCATCATCATCATCACAGCAGCGGCCTGGTGCCGCGCGGCAGCCAT";

describe("primer binding: placing a primer", () => {
  it("finds a primer that matches the top strand, and calls it forward", () => {
    const primer = T.slice(10, 30);
    const r = bindPrimer(T, primer);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.orientation, "forward");
    assert.deepStrictEqual([r.site.start, r.site.end], [10, 29]);
    assert.strictEqual(r.annealLength, 20);
    assert.strictEqual(r.tail, "");
    assert.strictEqual(r.mismatches, 0);
  });

  it("finds a primer that matches the bottom strand, and calls it reverse", () => {
    const primer = reverseComplement(T.slice(60, 82));
    const r = bindPrimer(T, primer);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.orientation, "reverse");
    assert.deepStrictEqual([r.site.start, r.site.end], [60, 81]);
  });

  it("is case- and whitespace-insensitive", () => {
    const primer = T.slice(10, 30).toLowerCase().replace(/(.{5})/g, "$1 ");
    assert.strictEqual(bindPrimer(T, primer).ok, true);
  });
});

describe("primer binding: 5' tails", () => {
  it("allows a tail that does not anneal, and reports it", () => {
    const anneal = T.slice(10, 30);
    const r = bindPrimer(T, `ggatccGAATTC${anneal}`);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tail, "ggatccgaattc");
    assert.strictEqual(r.annealSeq.toLowerCase(), anneal.toLowerCase());
    assert.strictEqual(r.annealLength, 20);
    assert.deepStrictEqual([r.site.start, r.site.end], [10, 29]);
  });

  it("keeps the whole primer, tail included, in the annotation it builds", () => {
    const anneal = T.slice(10, 30);
    const r = bindPrimer(T, `ggatcc${anneal}`);
    const p = virtualPrimer(r, { id: "p1", name: "pasted" });
    assert.strictEqual(p.bases, `ggatcc${anneal}`.toUpperCase());
    assert.deepStrictEqual([p.start, p.end, p.forward], [10, 29, true]);
    assert.strictEqual(p.type, "primer_bind");
  });

  it("builds a reverse annotation facing the right way", () => {
    const r = bindPrimer(T, reverseComplement(T.slice(60, 82)));
    const p = virtualPrimer(r, { id: "p2", name: "pasted" });
    assert.strictEqual(p.forward, false);
  });

  it("prefers a perfect annealing region over a longer mismatched one", () => {
    // the tail's last bases are deliberately near-template, so a
    // longest-wins rule would swallow them into the annealing region
    const anneal = T.slice(10, 30);
    const r = bindPrimer(T, `ggAtcA${anneal}`);
    assert.strictEqual(r.mismatches, 0);
    assert.strictEqual(r.annealLength, 20);
    assert.strictEqual(r.tail, "ggatca");
  });
});

describe("primer binding: mismatches", () => {
  const anneal = T.slice(10, 30);

  it("tolerates a mismatch when no clean stretch is long enough", () => {
    // mismatch 8 bases from the 3' end: the perfect 3' stretch is then only 7
    // bases, under the 12-base minimum, so the whole primer is placed with one
    // mismatch instead
    const i = anneal.length - 8;
    const mutated = `${anneal.slice(0, i)}${anneal[i] === "A" ? "C" : "A"}${anneal.slice(i + 1)}`;
    const r = bindPrimer(T, mutated);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.annealLength, 20);
    assert.strictEqual(r.mismatches, 1);
    assert.deepStrictEqual([r.site.start, r.site.end], [10, 29]);
  });

  it("reports a mismatch near the 5' end as tail, since a perfect site wins", () => {
    const mutated = `${anneal.slice(0, 3)}${anneal[3] === "A" ? "C" : "A"}${anneal.slice(4)}`;
    const r = bindPrimer(T, mutated);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.mismatches, 0);
    assert.strictEqual(r.annealLength, 16);
    assert.strictEqual(r.tail.length, 4);
  });

  it("will not place a primer whose 3' end does not match", () => {
    // last base changed: nothing can extend from there
    const mutated = `${anneal.slice(0, -1)}${anneal.slice(-1) === "A" ? "C" : "A"}`;
    const r = bindPrimer(T, mutated, { minAnneal: 19 });
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /no binding site/);
  });

  it("says so plainly when a primer does not bind at all", () => {
    const r = bindPrimer(T, "acacacacacacacacacacac");
    assert.strictEqual(r.ok, false);
    assert.deepStrictEqual(r.sites, []);
    assert.match(r.reason, /no binding site/);
  });

  it("refuses a primer too short to place", () => {
    const r = bindPrimer(T, "acgtacg");
    assert.strictEqual(r.ok, false);
    assert.match(r.reason, /at least 12 bases/);
  });

  it("reports an empty primer and an empty template separately", () => {
    assert.match(bindPrimer(T, "").reason, /no primer bases/);
    assert.match(bindPrimer("", T.slice(0, 20)).reason, /no template/);
  });
});

describe("primer binding: more than one site", () => {
  it("returns every site, so the caller can warn about extra bands", () => {
    const repeated = "ACGTACGTACGTAAAA" + T.slice(10, 34) + "TTTT" + T.slice(10, 34) + "GGGG";
    const r = bindPrimer(repeated, T.slice(14, 34));
    assert.strictEqual(r.ok, true);
    assert.ok(r.sites.length >= 2, "both copies found");
    assert.strictEqual(r.site, r.sites[0]);
  });
});

describe("primer binding: circular templates", () => {
  it("places a primer that spans the origin", () => {
    const circular = T.slice(50) + T.slice(0, 50);
    // a primer reading across the join of the rotated sequence
    const primer = (T.slice(40, 50) + T.slice(50, 62)).slice(0, 22);
    const straight = bindPrimer(circular, primer, { isCircular: false });
    const wrapped = bindPrimer(circular, primer, { isCircular: true });
    assert.strictEqual(wrapped.ok, true);
    assert.ok(wrapped.site.start > wrapped.site.end, "the site wraps the origin");
    assert.strictEqual(wrapped.annealLength, primer.length);
    // linearly the full primer is not present; at best a shorter 3' stretch is
    assert.ok(!straight.ok || straight.annealLength < primer.length);
    assert.ok(!straight.sites.some((s) => s.start > s.end), "no wrapped site when linear");
  });
});
