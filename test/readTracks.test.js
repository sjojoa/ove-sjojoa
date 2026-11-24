const assert = require("assert");
const RT = require("../src/alignment/readTracks.js");

describe("reads drawn on the map", () => {
  const results = [
    { refStart: 10, refEnd: 99, reversed: false, name: "colony1_F" },
    { refStart: 6000, refEnd: 120, reversed: true, name: "colony1_R" },
    { noSeed: true, name: "junk" },
  ];

  it("numbers the arrows the way the alignment numbers its tracks", () => {
    const anns = RT.annotationsFor(results);
    // track 0 is the template, so the first read is track 1
    assert.deepStrictEqual(anns.map((a) => a.id), ["ove-read-1", "ove-read-2"]);
  });

  it("points a reverse read backwards", () => {
    const [fwd, rev] = RT.annotationsFor(results);
    assert.strictEqual(fwd.forward, true);
    assert.strictEqual(rev.forward, false);
  });

  it("keeps a read that runs past the origin as one wrapping arrow", () => {
    const rev = RT.annotationsFor(results)[1];
    assert.strictEqual(rev.start, 6000);
    assert.strictEqual(rev.end, 120);
  });

  it("drops a read that never matched", () => {
    assert.strictEqual(RT.annotationsFor(results).length, 2);
  });

  it("colours everything red but the selected read", () => {
    const anns = RT.annotationsFor(results, 2);
    assert.strictEqual(anns[0].color, RT.RED);
    assert.strictEqual(anns[1].color, RT.BLUE);
  });

  it("takes the read arrows back out before a file is written", () => {
    const sd = {
      sequence: "atgc",
      lineageAnnotations: [
        { id: "ove-read-1", name: "colony1_F" },
        { id: "real-one", name: "something else" },
      ],
    };
    const out = RT.strip(sd);
    assert.deepStrictEqual(out.lineageAnnotations.map((a) => a.id), ["real-one"]);
    // and the original is left alone
    assert.strictEqual(sd.lineageAnnotations.length, 2);
  });

  it("survives a sequence that has no annotations of that kind", () => {
    assert.deepStrictEqual(RT.strip({ sequence: "atgc" }), { sequence: "atgc" });
  });
});
