// What the app says about the melting temperatures it reports (#27).
//
// One model, one set of conditions, said the same way everywhere a Tm
// appears -- the status bar, the primer hybridisation view, the Cloning
// tools. Issue #12 settled which model; this is where that decision is
// written down for the reader rather than left in a commit message.
//
// The NEB comparison is measured, not remembered: the three oligos in #12
// were run through NEB's own calculator (tmcalculator.neb.com, v1.17.0) at
// each product group's default primer concentration. NEB use the same
// SantaLucia (1998) parameters but a monovalent-only salt correction, and a
// different one again for Phusion, which is why the same oligo gets two
// different numbers from them and a third from us.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.oveTmNote = api;
})(typeof self !== "undefined" ? self : this, function () {
  const FALLBACK = { Na: 50, Mg: 1.5, dNTPs: 0.8, primerNM: 250 };

  function conditions(dnaTools) {
    const d = dnaTools || (typeof window !== "undefined" && window.dnaTools);
    return (d && d.DEFAULT_CONDITIONS) || FALLBACK;
  }

  // "250 nM primer, 50 mM Na⁺, 1.5 mM Mg²⁺, 0.8 mM dNTPs"
  function conditionsText(dnaTools) {
    const c = conditions(dnaTools);
    return [
      `${c.primerNM} nM primer`,
      `${c.Na} mM Na⁺`,
      `${c.Mg} mM Mg²⁺`,
      `${c.dNTPs} mM dNTPs`,
    ].join(", ");
  }

  const MODEL =
    "Nearest-neighbour Tm, SantaLucia (1998) parameters with the Owczarzy (2008) " +
    "salt correction for Mg²⁺ and dNTPs. Matches Biopython's Tm_NN to within 0.001 °C.";

  // Short enough to sit under a row of chips.
  function shortNote(dnaTools) {
    return `Tm at ${conditionsText(dnaTools)}. For Q5, anneal at Tm + 3 °C.`;
  }

  const NEB_PARAGRAPHS = [
    "Against NEB's own calculator on the same oligos, this number sits about 1–1.5 °C " +
      "below what NEB report for Phusion and about 4–5 °C below what they report for Q5. " +
      "Neither gap is an error: NEB use these same nearest-neighbour parameters but a " +
      "monovalent-only salt correction, and a different correction again for Phusion, to " +
      "stay compatible with Thermo Fisher's recommendations.",
    "NEB's advice for a Tm from any other calculator used with Q5 is to anneal at " +
      "Tm + 3 °C or above. Their Q5 rule is Ta = Tm of the lower primer + 1 °C, set from " +
      "what worked rather than derived.",
  ];

  const WHERE =
    "The status bar, the primer hybridisation view and the Cloning tools all use this " +
    "model at these conditions, so the numbers in different parts of the app agree.";

  return { conditions, conditionsText, shortNote, MODEL, NEB_PARAGRAPHS, WHERE, FALLBACK };
});
