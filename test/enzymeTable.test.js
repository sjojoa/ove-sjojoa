const assert = require("assert");
const E = require("../src/cloning/enzymeTable.js");

const ecoRI = { name: "EcoRI", site: "gaattc", topSnipOffset: 1, bottomSnipOffset: 5 };
const smaI = { name: "SmaI", site: "cccggg", topSnipOffset: 3, bottomSnipOffset: 3 };
const sacI = { name: "SacI", site: "gagctc", topSnipOffset: 5, bottomSnipOffset: 1 };
const alwNI = { name: "AlwNI", site: "cagnnnctg", topSnipOffset: 6, bottomSnipOffset: 3 };
const alu = { name: "AluI", site: "agct", topSnipOffset: 2, bottomSnipOffset: 2 };

describe("the enzyme table", () => {
  it("reads the overhang off the enzyme's own offsets", () => {
    assert.strictEqual(E.overhangOf(ecoRI), "5′");
    assert.strictEqual(E.overhangOf(sacI), "3′");
    assert.strictEqual(E.overhangOf(smaI), "blunt");
  });

  it("does not count N as part of the recognition site", () => {
    assert.strictEqual(E.specificity("CAGNNNCTG"), 6); // AlwNI is a six-cutter
    assert.strictEqual(E.specificity("GAATTC"), 6);
    assert.strictEqual(E.specificity("AGCT"), 4);
  });

  describe("filtering", () => {
    const rows = [
      E.row(ecoRI, [1200]),          // 1 site, 6 bp
      E.row(alwNI, [2889]),          // 1 site, 6 specific bases of 9
      E.row(alu, [10, 40, 90]),      // 3 sites, 4 bp
      E.row(smaI, [500, 900]),       // 2 sites
      E.row(sacI, []),               // does not cut
    ];
    const names = (opts) => E.filter(rows, opts).map((r) => r.name);

    it("finds the single cutters with a long enough site", () => {
      assert.deepStrictEqual(names({ cuts: "one-long" }), ["EcoRI", "AlwNI"]);
    });

    it("finds enzymes cutting once or twice", () => {
      assert.deepStrictEqual(names({ cuts: "one-two" }), ["EcoRI", "AlwNI", "SmaI"]);
    });

    it("finds the enzymes that do not cut at all", () => {
      assert.deepStrictEqual(names({ cuts: "none" }), ["SacI"]);
    });

    it("searches by name or by recognition site", () => {
      assert.deepStrictEqual(names({ cuts: "any", query: "gaatt" }), ["EcoRI"]);
      assert.deepStrictEqual(names({ cuts: "any", query: "alu" }), ["AluI"]);
    });

    it("keeps a chosen enzyme visible even when the filter excludes it", () => {
      // the whole point of choosing a non-cutter: it must not vanish
      assert.ok(names({ cuts: "one-long", selected: { saci: true } }).includes("SacI"));
    });
  });

  it("hands OVE's map filter one lowercase entry per chosen enzyme", () => {
    assert.deepStrictEqual(E.toMapFilter({ ecori: true, saci: true, bamhi: false }), [
      { value: "ecori", label: "ecori" },
      { value: "saci", label: "saci" },
    ]);
  });
});

describe("isoschizomers", () => {
  // AanI and PsiI are the same enzyme by another name: same site, same cut
  const aanI = { name: "AanI", site: "ttataa", topSnipOffset: 3, bottomSnipOffset: 3 };
  const psiI = { name: "PsiI", site: "ttataa", topSnipOffset: 3, bottomSnipOffset: 3 };
  const xmaI = { name: "XmaI", site: "cccggg", topSnipOffset: 1, bottomSnipOffset: 5 };
  const smaI2 = { name: "SmaI", site: "cccggg", topSnipOffset: 3, bottomSnipOffset: 3 };

  const rows = [E.row(aanI, [2089]), E.row(psiI, [2089]), E.row(xmaI, [1425]), E.row(smaI2, [1427])];

  it("puts enzymes with the same site and the same cut on one row", () => {
    const g = E.groupIsoschizomers(rows);
    assert.strictEqual(g.length, 3);
    const ttataa = g.find((r) => r.site === "TTATAA");
    assert.deepStrictEqual(ttataa.aliases.length, 1);
  });

  it("keeps XmaI and SmaI apart: same site, different cut", () => {
    const g = E.groupIsoschizomers(rows);
    assert.ok(g.some((r) => r.name === "XmaI"));
    assert.ok(g.some((r) => r.name === "SmaI"));
  });

  it("leads the row with the name you are likelier to have", () => {
    const g = E.groupIsoschizomers(rows, { preferred: ["PsiI"] });
    const ttataa = g.find((r) => r.site === "TTATAA");
    assert.strictEqual(ttataa.name, "PsiI");
    assert.deepStrictEqual(ttataa.aliases, ["AanI"]);
  });

  it("finds a row by the name of one of its isoschizomers", () => {
    const g = E.groupIsoschizomers(rows, { preferred: ["AanI"] });
    assert.deepStrictEqual(E.filter(g, { cuts: "any", query: "psi" }).map((r) => r.name), ["AanI"]);
  });
});

describe("choosing which name leads the row", () => {
  const aanI = { name: "AanI", site: "ttataa", topSnipOffset: 3, bottomSnipOffset: 3 };
  const psiI = { name: "PsiI", site: "ttataa", topSnipOffset: 3, bottomSnipOffset: 3 };
  const zzzI = { name: "ZzzI", site: "ttataa", topSnipOffset: 3, bottomSnipOffset: 3 };
  const rows = [E.row(aanI, [10]), E.row(psiI, [10]), E.row(zzzI, [10])];

  it("leads with the name your supplier sells", () => {
    // NEB sells PsiI, Thermo sells AanI, nobody sells ZzzI
    const g = E.groupIsoschizomers(rows, { sells: (n) => n === "PsiI", sold: (n) => n !== "ZzzI" });
    assert.strictEqual(g[0].name, "PsiI");
    assert.deepStrictEqual(g[0].aliases, ["AanI", "ZzzI"]);
  });

  it("falls back to a name someone sells when your supplier has none", () => {
    const g = E.groupIsoschizomers(rows, { sells: () => false, sold: (n) => n === "AanI" });
    assert.strictEqual(g[0].name, "AanI");
  });
});

describe("the enzyme presets", () => {
  const bsaI = { name: "BsaI", site: "ggtctc", topSnipOffset: 7, bottomSnipOffset: 11 };
  const ecoRI2 = { name: "EcoRI", site: "gaattc", topSnipOffset: 1, bottomSnipOffset: 5 };
  const aluI = { name: "AluI", site: "agct", topSnipOffset: 2, bottomSnipOffset: 2 };

  it("spots a Type IIS enzyme by where it cuts, not by a flag", () => {
    // the database carries no isType2S; cutting past the end of the site is the test
    assert.strictEqual(E.cutsOutsideSite(bsaI), true);
    assert.strictEqual(E.cutsOutsideSite(ecoRI2), false);
  });

  it("filters to Type IIS", () => {
    const rows = [E.row(bsaI, [100]), E.row(ecoRI2, [200])];
    assert.deepStrictEqual(E.filter(rows, { cuts: "type2s" }).map((r) => r.name), ["BsaI"]);
  });

  it("filters to the Golden Gate enzymes, including under an isoschizomer's name", () => {
    const esp3I = { name: "Esp3I", site: "cgtctc", topSnipOffset: 7, bottomSnipOffset: 11 };
    const rows = [E.row(bsaI, [100]), E.row(esp3I, [300]), E.row(ecoRI2, [200])];
    assert.deepStrictEqual(E.filter(rows, { cuts: "goldengate" }).map((r) => r.name), ["BsaI", "Esp3I"]);
    // BsmBI leads the row, Esp3I is its other name: still Golden Gate
    const grouped = [{ ...E.row(esp3I, [300]), name: "BsmBI", key: "bsmbi", aliases: ["Esp3I"] }];
    assert.strictEqual(E.filter(grouped, { cuts: "goldengate" }).length, 1);
  });

  it("filters to long recognition sites whatever the cut count", () => {
    const rows = [E.row(ecoRI2, [1, 2, 3]), E.row(aluI, [1])];
    assert.deepStrictEqual(E.filter(rows, { cuts: "long" }).map((r) => r.name), ["EcoRI"]);
  });
});
