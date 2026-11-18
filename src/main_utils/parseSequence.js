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

module.exports = { anyToJson, correctFileName };
