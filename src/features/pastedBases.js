// Deciding whether pasted text is "just bases", and cleaning it up if so.
//
// bio-parsers' Fasta parser will accept anything here: it strips whatever is
// not a base and calls the leftovers a sequence, so an email signature imports
// as a 35 bp construct. Sequences do get pasted with line numbers and spaces
// (from a vendor's page, a Word document, a Genbank ORIGIN block), so those
// have to be ignored — but everything else has to be rare before the text
// counts as a sequence at all.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.ovePastedBases = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // IUPAC, plus the gap characters an alignment may carry
  const BASES = /[acgtunryswkmbdhvxACGTUNRYSWKMBDHVX.-]/g;
  const STRUCTURED = /^\s*(>|LOCUS|ORIGIN|\{|##)/i;
  const MIN_BASE_FRACTION = 0.9;

  // Does this text announce a format of its own (FASTA, Genbank, JSON, GFF)?
  const isStructured = (text) => STRUCTURED.test(String(text || ""));

  // { ok, sequence, dropped, fraction, reason }
  function rawBases(text) {
    const compact = String(text || "").replace(/[\s\d]/g, "");
    const bases = (compact.match(BASES) || []).join("");
    const fraction = compact.length ? bases.length / compact.length : 0;
    if (!compact.length) {
      return { ok: false, sequence: "", dropped: 0, fraction: 0, reason: "nothing to read" };
    }
    if (fraction < MIN_BASE_FRACTION) {
      return {
        ok: false,
        sequence: "",
        dropped: compact.length - bases.length,
        fraction,
        reason: `that does not look like a sequence — ${Math.round(
          (1 - fraction) * 100
        )}% of the characters are not bases`,
      };
    }
    return {
      ok: true,
      sequence: bases,
      dropped: compact.length - bases.length,
      fraction,
      reason: null,
    };
  }

  return { isStructured, rawBases, MIN_BASE_FRACTION };
});
