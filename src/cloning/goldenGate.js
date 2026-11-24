// Golden Gate: work out what order the parts go in, or why they will not.
//
// A Type IIS enzyme cuts outside its own site, so each part comes out of its
// plasmid carrying four bases of overhang that it chose. Those overhangs are
// the assembly instructions: each one appears exactly twice in the pot, once
// on each side of a join, and the parts line up in one circular order. When
// an overhang appears more often than that, or matches its own complement,
// the pot has more than one answer and you get a mixture.
//
// Finding the order is a small search, not a heuristic: a digest usually
// leaves more than one fragment with enzyme ends on both sides -- a part and
// the plasmid that carried it -- so rather than guessing which is the part,
// try them and keep the combination that closes a circle using one fragment
// from each input.
//
// Pure: the caller does the digesting and passes fragments in.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveGoldenGate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COMP = { A: "T", T: "A", G: "C", C: "G", N: "N" };
  const revcomp = (s) =>
    String(s || "").toUpperCase().split("").reverse().map((c) => COMP[c] || c).join("");

  const seqOf = (end) => String((end && end.seq) || "").toUpperCase();

  // Two ends join when they are the same kind of end carrying the same bases,
  // which is the rule the ligation code already uses.
  function joins(rightEnd, leftEnd) {
    if (!rightEnd || !leftEnd) return false;
    if (rightEnd.type === "end" || leftEnd.type === "end") return false;
    return rightEnd.type === leftEnd.type && seqOf(rightEnd) === seqOf(leftEnd);
  }

  // A candidate is a fragment with an enzyme-cut end on both sides: the only
  // kind that can sit inside a Golden Gate circle.
  const usable = (frag) =>
    !!frag && !!frag.left && !!frag.right && frag.left.type !== "end" && frag.right.type !== "end";

  // The circular order, starting from the first input (the destination
  // vector). Returns null when no combination closes.
  function chain(parts) {
    const n = (parts || []).length;
    if (!n) return null;
    const firstCandidates = (parts[0].candidates || []).filter(usable);

    for (const start of firstCandidates) {
      const used = [{ part: 0, fragment: start }];
      const taken = new Set([0]);
      const walk = (tail) => {
        if (used.length === n) return joins(tail.right, start.left) ? used.slice() : null;
        for (let i = 0; i < n; i++) {
          if (taken.has(i)) continue;
          for (const cand of (parts[i].candidates || []).filter(usable)) {
            if (!joins(tail.right, cand.left)) continue;
            taken.add(i);
            used.push({ part: i, fragment: cand });
            const done = walk(cand);
            if (done) return done;
            used.pop();
            taken.delete(i);
          }
        }
        return null;
      };
      const found = walk(start);
      if (found) return found.map((step) => ({ name: parts[step.part].name, index: step.part, fragment: step.fragment }));
    }
    return null;
  }

  // What is wrong with the overhangs, worst first. An assembly can close and
  // still be a bad idea.
  function problems(order) {
    const out = [];
    if (!order || !order.length) return out;
    const seen = {};
    order.forEach((step) => {
      const seq = seqOf(step.fragment.right);
      seen[seq] = (seen[seq] || 0) + 1;
    });
    Object.keys(seen).forEach((seq) => {
      if (seen[seq] > 1) {
        out.push({
          level: "danger",
          text: `the ${seq} overhang is used at ${seen[seq]} junctions, so the parts can go together in more than one order`,
        });
      }
      if (seq && seq === revcomp(seq)) {
        out.push({
          level: "danger",
          text: `the ${seq} overhang is its own reverse complement, so that part can go in backwards`,
        });
      }
    });
    return out;
  }

  // Why nothing closed: which overhangs have no partner in the pot.
  function unmatched(parts) {
    const lefts = [];
    const rights = [];
    (parts || []).forEach((p) => {
      (p.candidates || []).filter(usable).forEach((c) => {
        lefts.push({ name: p.name, end: c.left });
        rights.push({ name: p.name, end: c.right });
      });
    });
    return rights
      .filter((r) => !lefts.some((l) => joins(r.end, l.end)))
      .map((r) => ({ name: r.name, overhang: seqOf(r.end) }));
  }

  return { chain, problems, unmatched, joins, usable, revcomp };
});
