// Is this clone the one you designed?
//
// The app can already align Sanger reads to a sequence and draw the traces.
// What it could not do is answer the question you actually have: does the
// colony match the construct, and if not, where and does it matter. This
// turns an alignment into that answer -- every difference in reference
// coordinates, what feature it lands in, what it does to the protein, and
// which stretches no read covered at all.
//
// Pure: it takes aligned strings, not files.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveCloneCheck = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const GAP = "-";

  function codonTable() {
    if (typeof window !== "undefined" && window.dnaTools) return window.dnaTools.CODON_TABLE;
    return require("../cloning/dnaTools.js").CODON_TABLE;
  }

  // One read against the reference. Columns outside the read are not its
  // fault, so identity is measured only across what it actually covers.
  function readReport({ refAligned, readAligned, name, reversed }) {
    const ref = String(refAligned || "").toUpperCase();
    const read = String(readAligned || "").toUpperCase();
    const first = read.search(/[^-]/);
    const report = {
      name: name || "read",
      reversed: !!reversed,
      start: null,
      end: null,
      matches: 0,
      mismatches: [],
      insertions: [],
      deletions: [],
      identity: 0,
      covered: 0,
    };
    if (first === -1) return report;
    const last = read.length - 1 - [...read].reverse().join("").search(/[^-]/);

    let refPos = 0; // reference coordinate of the current column
    for (let col = 0; col < ref.length; col++) {
      const r = ref[col];
      const q = read[col];
      const inRead = col >= first && col <= last;
      if (inRead) {
        if (report.start === null && r !== GAP) report.start = refPos;
        if (r !== GAP) report.end = refPos;
        if (r === GAP && q !== GAP) {
          const prev = report.insertions[report.insertions.length - 1];
          if (prev && prev.at === refPos && prev.endCol === col - 1) {
            prev.bases += q;
            prev.endCol = col;
          } else report.insertions.push({ at: refPos, bases: q, endCol: col });
        } else if (q === GAP && r !== GAP) {
          const prev = report.deletions[report.deletions.length - 1];
          if (prev && prev.at + prev.length === refPos) prev.length += 1;
          else report.deletions.push({ at: refPos, length: 1 });
        } else if (r !== GAP && q !== GAP) {
          if (r === q) report.matches += 1;
          else report.mismatches.push({ at: refPos, ref: r, read: q });
        }
      }
      if (r !== GAP) refPos += 1;
    }
    report.covered = report.start === null ? 0 : report.end - report.start + 1;
    const compared = report.matches + report.mismatches.length;
    report.identity = compared ? (report.matches / compared) * 100 : 0;
    report.insertions.forEach((i) => delete i.endCol);
    return report;
  }

  // Stretches of the reference no read reached. A clone is only verified
  // where someone read it.
  function coverage(reports, refLength) {
    const hit = new Uint8Array(refLength);
    (reports || []).forEach((r) => {
      if (r.start === null) return;
      for (let i = r.start; i <= r.end && i < refLength; i++) hit[i] = 1;
    });
    const gaps = [];
    let run = null;
    for (let i = 0; i < refLength; i++) {
      if (!hit[i]) {
        if (run) run.end = i;
        else run = { start: i, end: i };
      } else if (run) {
        gaps.push(run);
        run = null;
      }
    }
    if (run) gaps.push(run);
    const covered = hit.reduce((total, x) => total + x, 0);
    return { covered, gaps, fraction: refLength ? covered / refLength : 0 };
  }

  const featuresAt = (features, pos) =>
    (features || []).filter((f) => pos >= f.start && pos <= f.end).map((f) => f.name).filter(Boolean);

  // What a single-base change does to the protein, when it lands in a CDS.
  // Returns null outside a coding feature.
  function consequence(sequence, feature, at, newBase) {
    if (!feature || String(feature.type || "").toUpperCase() !== "CDS") return null;
    if (at < feature.start || at > feature.end) return null;
    if (feature.forward === false) return null; // shortcut: forward CDS only, flip the feature to check a reverse one
    const table = codonTable();
    const offset = at - feature.start;
    const codonIndex = Math.floor(offset / 3);
    const codonStart = feature.start + codonIndex * 3;
    const original = sequence.slice(codonStart, codonStart + 3).toUpperCase();
    if (original.length < 3) return null;
    const mutated = original.split("");
    mutated[offset % 3] = String(newBase).toUpperCase();
    const from = table[original];
    const to = table[mutated.join("")];
    if (!from || !to) return null;
    const residue = codonIndex + 1;
    if (from === to) return { kind: "silent", text: `silent (${from}${residue})` };
    if (to === "*") return { kind: "nonsense", text: `stop gained (${from}${residue}*)` };
    if (from === "*") return { kind: "readthrough", text: `stop lost (${from}${residue}${to})` };
    return { kind: "missense", text: `${from}${residue}${to}` };
  }

  // One line, the thing you actually want to know.
  function verdict(reports, refLength) {
    const cov = coverage(reports, refLength);
    const diffs = (reports || []).reduce(
      (total, r) => total + r.mismatches.length + r.insertions.length + r.deletions.length,
      0
    );
    const pct = Math.round(cov.fraction * 100);
    if (!reports || !reports.length) return { level: "warning", text: "No reads to check against." };
    if (diffs) {
      return {
        level: "danger",
        text: `${diffs} difference${diffs > 1 ? "s" : ""} from the construct, over ${pct}% of it read.`,
      };
    }
    if (cov.gaps.length) {
      return {
        level: "warning",
        text: `No differences where it was read, but ${pct}% covered — ${cov.gaps.length} stretch${cov.gaps.length > 1 ? "es" : ""} unread.`,
      };
    }
    return { level: "success", text: "Every base read matches the construct, and the reads cover all of it." };
  }

  return { readReport, coverage, featuresAt, consequence, verdict };
});
