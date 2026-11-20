const assert = require("assert");
const N = require("../src/features/tmNote.js");
const dnaTools = require("../src/cloning/dnaTools.js");

describe("what the app says about its melting temperatures (#27)", () => {
  it("reads the conditions off dnaTools rather than restating them", () => {
    assert.deepStrictEqual(N.conditions(dnaTools), dnaTools.DEFAULT_CONDITIONS);
    const c = dnaTools.DEFAULT_CONDITIONS;
    assert.strictEqual(
      N.conditionsText(dnaTools),
      `${c.primerNM} nM primer, ${c.Na} mM Na⁺, ${c.Mg} mM Mg²⁺, ${c.dNTPs} mM dNTPs`
    );
  });

  it("falls back to the documented defaults if dnaTools is not loaded yet", () => {
    assert.deepStrictEqual(N.conditions(null), N.FALLBACK);
    // and the fallback is not a guess: it is what dnaTools actually uses
    assert.deepStrictEqual(N.FALLBACK, dnaTools.DEFAULT_CONDITIONS);
  });

  it("names every condition the salt correction depends on", () => {
    const text = N.conditionsText(dnaTools);
    ["nM primer", "mM Na", "mM Mg", "mM dNTPs"].forEach((bit) => {
      assert.ok(text.includes(bit), `${bit} missing from "${text}"`);
    });
  });

  it("carries NEB's Q5 advice where a number is read off", () => {
    assert.ok(/anneal at Tm \+ 3/.test(N.shortNote(dnaTools)));
    assert.ok(N.shortNote(dnaTools).includes(N.conditionsText(dnaTools)));
  });

  it("says which model, and that it was checked against something", () => {
    assert.ok(/SantaLucia/.test(N.MODEL));
    assert.ok(/Owczarzy/.test(N.MODEL));
    assert.ok(/Biopython/.test(N.MODEL));
  });

  it("explains the gap to NEB rather than just stating it", () => {
    const all = N.NEB_PARAGRAPHS.join(" ");
    assert.ok(/Phusion/.test(all));
    assert.ok(/Q5/.test(all));
    assert.ok(/monovalent-only/.test(all), "says why the Q5 gap exists");
    assert.ok(/Tm \+ 3/.test(all));
  });
});
