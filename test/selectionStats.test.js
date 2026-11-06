const assert = require("assert");
const {
  stats,
  format,
  selectedSequence,
  conditionsText,
  MIN_TM_BP,
  MAX_TM_BP,
} = require("../src/features/selectionStats");
const dnaTools = require("../src/cloning/dnaTools");

const P20 = "acgacgcgctcattcccttg";

describe("selection stats: what a selection is worth saying", () => {
  it("reports GC and Tm for a primer-sized selection", () => {
    const s = stats(P20);
    assert.strictEqual(s.length, 20);
    assert.strictEqual(s.gc, 60);
    assert.ok(Math.abs(s.tm - 66.8) < 0.1, `tm was ${s.tm}`);
  });

  it("agrees with the Tm the Cloning menu reports", () => {
    // the whole point of not switching upstream's display on as it stands
    ["acgacgcgctcattcccttg", "atgggcagcagccatcatcat", "ggcagcttacgtacggatcc"].forEach((seq) => {
      assert.strictEqual(stats(seq).tm, dnaTools.tm(seq));
    });
  });

  it("withholds Tm above the oligo range but still gives GC", () => {
    const long = "ACGT".repeat(50);
    const s = stats(long);
    assert.strictEqual(s.tm, null);
    assert.strictEqual(s.tooLongForTm, true);
    assert.strictEqual(s.gc, 50);
    assert.strictEqual(format(long, {}), " · 50% GC");
  });

  it("withholds Tm below the oligo range", () => {
    const short = "ACGTAC";
    assert.ok(short.length < MIN_TM_BP);
    assert.strictEqual(stats(short).tm, null);
    assert.strictEqual(format(short, {}), " · 50% GC");
  });

  it("keeps Tm right up to the length limit", () => {
    const edge = "GGCAGCTTACGTACGGATCCATGCATTGAC".padEnd(MAX_TM_BP, "A");
    assert.strictEqual(edge.length, MAX_TM_BP);
    assert.ok(Number.isFinite(stats(edge).tm));
    assert.strictEqual(stats(edge + "A").tm, null);
  });

  it("formats the status bar suffix", () => {
    assert.strictEqual(format(P20, {}), " · Tm 66.8 °C · 60% GC");
    assert.strictEqual(format(P20, { showTm: false }), " · 60% GC");
    assert.strictEqual(format(P20, { showGC: false }), " · Tm 66.8 °C");
    assert.strictEqual(format(P20, { showTm: false, showGC: false }), "");
    assert.strictEqual(format("", {}), "");
  });

  it("honours the GC decimal digits setting", () => {
    assert.strictEqual(format("ACGTACGTAC", { showTm: false, GCDecimalDigits: 1 }), " · 50.0% GC");
    assert.strictEqual(format("ACGTACGTAC", { showTm: false, GCDecimalDigits: 0 }), " · 50% GC");
  });

  it("takes the bases a selection layer covers", () => {
    const seq = "AAAACCCCGGGGTTTT";
    assert.strictEqual(selectedSequence({ start: 4, end: 7 }, seq), "CCCC");
    assert.strictEqual(selectedSequence({ start: 0, end: 0 }, seq), "A");
    // a selection across the origin of a circular sequence
    assert.strictEqual(selectedSequence({ start: 14, end: 1 }, seq), "TTAA");
    assert.strictEqual(selectedSequence({ start: -1, end: -1 }, seq), "");
    assert.strictEqual(selectedSequence(null, seq), "");
    assert.strictEqual(selectedSequence({ start: 0, end: 3 }, ""), "");
  });

  it("ignores whitespace in the selected bases", () => {
    assert.strictEqual(stats(" acga cgcg ctca ttcc cttg ").tm, stats(P20).tm);
  });

  it("states the conditions the Tm was computed at", () => {
    const text = conditionsText();
    assert.ok(text.includes(`${dnaTools.DEFAULT_CONDITIONS.primerNM} nM primer`), text);
    assert.ok(text.includes(`${dnaTools.DEFAULT_CONDITIONS.Na} mM Na`), text);
    assert.ok(text.includes(`${dnaTools.DEFAULT_CONDITIONS.Mg} mM Mg`), text);
    assert.ok(text.includes(`${dnaTools.DEFAULT_CONDITIONS.dNTPs} mM dNTPs`), text);
  });
});
