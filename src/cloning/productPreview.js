// What the assembly will actually be, before you order anything.
//
// The cloning tools already compute the product; what was missing was seeing
// it first. This works out the geometry of an assembled construct -- where
// each piece lands, where the pieces meet, and what the overlap at each join
// is -- so a dialog can show the junctions and check them (#42).
//
// Pure: it takes sequences and lengths and returns plain objects, so the
// checks can be tested without a window.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveProductPreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COMP = { A: "T", T: "A", G: "C", C: "G", N: "N" };
  const revcomp = (s) =>
    s.split("").reverse().map((c) => COMP[c] || c).join("");

  // Where each piece sits in the concatenated product.
  function layout(pieces) {
    let at = 0;
    return (pieces || []).map((p) => {
      const length = (p.sequence || "").length;
      const row = { name: p.name, length: length, start: at, end: at + length - 1 };
      at += length;
      return row;
    });
  }

  // Read `count` bases from `at`, going round the origin on a circular product.
  function read(sequence, at, count, circular) {
    const n = sequence.length;
    if (!n || count <= 0) return "";
    if (!circular) return sequence.slice(Math.max(0, at), Math.max(0, at) + count);
    let out = "";
    for (let i = 0; i < count; i++) out += sequence[(((at + i) % n) + n) % n];
    return out;
  }

  function gc(seq) {
    if (!seq.length) return 0;
    const g = (seq.toUpperCase().match(/[GC]/g) || []).length;
    return (g / seq.length) * 100;
  }

  // An overlap that occurs more than once in the product can join the wrong
  // two pieces, which is a real way for an assembly to come back scrambled.
  function occurrences(sequence, overlap, circular) {
    const seq = (sequence || "").toUpperCase();
    const needle = (overlap || "").toUpperCase();
    if (!seq || !needle) return 0;
    const hay = circular ? seq + seq.slice(0, needle.length - 1) : seq;
    let count = 0;
    for (const strand of [needle, revcomp(needle)]) {
      let i = hay.indexOf(strand);
      while (i !== -1) {
        count++;
        i = hay.indexOf(strand, i + 1);
      }
      if (strand === revcomp(strand)) break; // a palindrome is not two hits
    }
    return count;
  }

  // The joins, in assembly order. On a circular product the last piece joins
  // back to the first; on a linear one it does not.
  function junctions({ pieces, sequence, overlap = 20, circular = true, flank = 12 }) {
    const rows = layout(pieces);
    const seq = (sequence || "").toUpperCase();
    const n = seq.length;
    if (rows.length < 2 || !n) return [];
    const joins = [];
    const last = circular ? rows.length : rows.length - 1;
    for (let i = 0; i < last; i++) {
      const left = rows[i];
      const right = rows[(i + 1) % rows.length];
      const at = (left.end + 1) % n; // first base of the right piece
      const width = Math.min(overlap, left.length);
      const overlapSeq = read(seq, at - width < 0 ? at - width + n : at - width, width, circular);
      joins.push({
        after: left.name,
        before: right.name,
        at: at,
        overlap: overlapSeq,
        length: overlapSeq.length,
        gc: gc(overlapSeq),
        // the overlap lives at the end of the left piece, so the bases shown
        // before it come from the left piece and those after it from the right
        before5: read(seq, at - width - flank < 0 ? at - width - flank + n : at - width - flank, flank, circular),
        after3: read(seq, at, flank, circular),
        occurrences: occurrences(seq, overlapSeq, circular),
      });
    }
    return joins;
  }

  // Ligation junctions. Unlike a Gibson overlap, a sticky end is trimmed off
  // the left piece before the join, so the overhang bases belong to the start
  // of the right piece. `pieces` is [{name, length}] in assembly order and
  // `joins` is [{overhang, enzymes}], one per piece, joining it to the next.
  function ligationJoins({ pieces, joins, sequence, circular = true, flank = 12 }) {
    const seq = (sequence || "").toUpperCase();
    const n = seq.length;
    if (!n || !(pieces || []).length) return [];
    let at = 0;
    const rows = (pieces || []).map((piece, i) => {
      const next = pieces[(i + 1) % pieces.length];
      at += piece.length;
      const start = at % n;
      const join = (joins || [])[i] || {};
      const overhang = (join.overhang || "").toUpperCase();
      return {
        after: piece.name,
        before: next.name,
        at: start,
        overhang: overhang,
        blunt: !overhang.length,
        enzymes: (join.enzymes || []).filter(Boolean),
        before5: read(seq, start - flank < 0 ? start - flank + n : start - flank, flank, circular),
        after3: read(seq, (start + overhang.length) % n, flank, circular),
      };
    });
    return circular ? rows : rows.slice(0, -1);
  }

  // One line per problem, worst first. Empty means the assembly looks sound.
  function problems(joins, { minOverlap = 15, minTm = 48 } = {}) {
    const out = [];
    (joins || []).forEach((j) => {
      const where = `${j.after} → ${j.before}`;
      if (j.occurrences > 1) {
        out.push({
          level: "danger",
          text: `${where}: the ${j.length} bp overlap appears ${j.occurrences} times in the product, so the pieces can join in the wrong order. Move the junction or lengthen the overlap.`,
        });
      }
      if (j.length < minOverlap) {
        out.push({
          level: "danger",
          text: `${where}: only ${j.length} bp of overlap — below the ${minOverlap} bp this assembly was designed for.`,
        });
      }
      if (typeof j.tm === "number" && j.tm < minTm) {
        out.push({
          level: "warning",
          text: `${where}: overlap Tm ${j.tm.toFixed(1)} °C, below ${minTm} °C. Lengthen the overlap or move it into GC-richer sequence.`,
        });
      }
      if (j.gc < 25 || j.gc > 75) {
        out.push({
          level: "warning",
          text: `${where}: overlap is ${Math.round(j.gc)}% GC, outside the 25–75% that assembles reliably.`,
        });
      }
    });
    return out;
  }

  // For an assembly whose piece boundaries we do not have -- primers someone
  // else designed -- locate a junction by its overlap instead. Returns null
  // when the overlap is not unique, since then there is no one place to show.
  function contextOf(sequence, overlap, { circular = true, flank = 12 } = {}) {
    const seq = (sequence || "").toUpperCase();
    const needle = (overlap || "").toUpperCase();
    if (!seq || !needle) return null;
    const hay = circular ? seq + seq.slice(0, needle.length - 1) : seq;
    const first = hay.indexOf(needle);
    if (first === -1 || hay.indexOf(needle, first + 1) !== -1) return null;
    const n = seq.length;
    const start = first % n;
    const at = (start + needle.length) % n;
    return {
      at: at,
      before5: read(seq, start - flank < 0 ? start - flank + n : start - flank, flank, circular),
      after3: read(seq, at, flank, circular),
    };
  }

  function summary({ pieces, sequence, circular = true }) {
    const rows = layout(pieces);
    return {
      pieces: rows,
      length: (sequence || "").length,
      circular: !!circular,
      order: rows.map((r) => r.name),
    };
  }

  return { layout, junctions, ligationJoins, problems, summary, contextOf, occurrences, read, gc, revcomp };
});
