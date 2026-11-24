// One list of sequence file formats, so opening and saving cannot drift apart.
//
// EXTENSIONS is what can be read: File > Open, the Cloning menu's file picker
// and the Import dialog. SAVE_FILTERS is what can be written, in the order the
// Save dialog offers them, and the first one is the default. "txt" is the
// lab's inline-tagged format (src/features/taggedText.js).
//
// Loaded in the renderer as a plain script too, so the Save dialog reads the
// same list instead of keeping a second copy of it.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveSequenceFileFilters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const EXTENSIONS = [
    "gb", "gbk", "genbank", "gp", "dna", "fasta", "fa", "fas", "fna", "ffn",
    "gff", "gff3", "json", "txt", "ab1", "scf",
  ];

  // What main.js can actually write (see the ove_saveFile handler): anything
  // else here would be offered in the dialog and then written as GenBank.
  const SAVE_FILTERS = [
    { name: "Genbank", extensions: ["gb"] },
    { name: "Fasta", extensions: ["fasta"] },
    { name: "TeselaGen JSON", extensions: ["json"] },
    { name: "Bed", extensions: ["bed"] },
    { name: "Tagged text", extensions: ["txt"] },
  ];

  // Strips whichever of those a file name ends with, and only at the end.
  const SAVE_EXT = new RegExp(`\\.(${SAVE_FILTERS.map((f) => f.extensions[0]).join("|")})$`, "i");

  return {
    EXTENSIONS,
    SAVE_FILTERS,
    SAVE_EXT,
    filters: [{ name: "Sequence Files", extensions: EXTENSIONS }],
  };
});
