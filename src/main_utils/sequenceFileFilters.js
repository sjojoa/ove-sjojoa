// One list of sequence file extensions, shared by File > Open, the Cloning
// menu's file picker and the Import dialog, so they cannot drift apart.
// "txt" is the lab's inline-tagged format (src/features/taggedText.js).
const EXTENSIONS = [
  "gb", "gbk", "genbank", "gp", "dna", "fasta", "fa", "fas", "fna", "ffn",
  "gff", "gff3", "json", "txt",
];

module.exports = {
  EXTENSIONS,
  filters: [{ name: "Sequence Files", extensions: EXTENSIONS }],
};
