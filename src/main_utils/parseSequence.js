// SnapGene's .dna extension gets put on plain GenBank text often enough that
// the extension cannot be trusted: exported by a sequencing vendor, saved out
// of another tool, renamed by hand. bio-parsers dispatches on the extension
// alone, so those files fail with "Wrong format for a SnapGene file" and the
// window opens empty. Sniffing the first bytes costs nothing, and only
// overrides the name when the file plainly is not what it claims to be.
const bioParsers = require("bio-parsers");

const GENBANK_EXT = /\.(gb|gbk|genbank|gp)$/i;

function head(data, n = 10) {
  return Buffer.isBuffer(data) ? data.slice(0, n).toString("latin1") : String(data).slice(0, n);
}

// The name to hand bio-parsers: the real one, unless the content says the
// extension is lying.
function correctFileName(data, fileName) {
  if (!/^LOCUS\s/.test(head(data))) return fileName;
  if (GENBANK_EXT.test(fileName || "")) return fileName;
  return `${fileName || "sequence"}.gb`;
}

function anyToJson(data, fileName) {
  return bioParsers.anyToJson(data, { fileName: correctFileName(data, fileName) });
}

// The lab's inline-tagged format, read the same way whether it arrives as a
// file or as pasted text. bio-parsers would read it as one long run of bases
// with the tags treated as garbage, so it is caught before that; a .txt with
// no tag pairs in it is not tagged text and still goes to bio-parsers.
// `fallbackName` is used only when the text carries no name of its own.
function readTagged(taggedText, text, fallbackName) {
  if (!taggedText.looksTagged(text)) return null;
  const { sequenceData, warnings } = taggedText.taggedToSequenceData(text);
  if (!sequenceData.name || sequenceData.name === "Untitled Sequence") {
    sequenceData.name = fallbackName;
  }
  return { sequenceData, warnings };
}

module.exports = { anyToJson, correctFileName, readTagged };
