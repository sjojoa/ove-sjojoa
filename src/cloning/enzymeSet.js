// The enzymes you chose for the map, saved with the sequence.
//
// Keeping them in the editor only means they are gone next time the file is
// opened -- and the point of putting a non-cutter on the map is that it is
// still there months later, when an edit finally creates that site. GenBank
// has nowhere formal to put this, so it goes in a COMMENT line that other
// software ignores and bio-parsers round-trips unchanged.
//
//   COMMENT     ove-enzymes: bsai,ecori,noti
//
// Pure: takes sequence data, returns names or new sequence data.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveEnzymeSet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TAG = "ove-enzymes:";

  const isOurs = (line) => String(line || "").trim().toLowerCase().startsWith(TAG);

  // The enzyme names saved with this sequence, lowercased. Empty when none.
  function read(seqData) {
    const line = ((seqData || {}).comments || []).find(isOurs);
    if (!line) return [];
    return String(line)
      .trim()
      .slice(TAG.length)
      .split(",")
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean);
  }

  // A copy of seqData carrying exactly these names. Passing none removes the
  // line rather than leaving an empty one behind.
  function write(seqData, names) {
    const kept = ((seqData || {}).comments || []).filter((c) => !isOurs(c));
    const clean = [...new Set((names || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean))].sort();
    const comments = clean.length ? [...kept, `${TAG} ${clean.join(",")}`] : kept;
    return { ...seqData, comments };
  }

  // OVE's map filter holds special entries ("single cutters", "type2s")
  // alongside plain enzyme names; only the names are ours to save.
  function fromFilter(filteredRestrictionEnzymes) {
    return (filteredRestrictionEnzymes || [])
      .filter((e) => e && e.value && !e.cutsThisManyTimes && e.value !== "type2s" && !String(e.value).includes("__userCreatedGroup"))
      .map((e) => String(e.value).toLowerCase());
  }

  const toFilter = (names) => (names || []).map((n) => ({ value: n, label: n }));

  return { read, write, fromFilter, toFilter, TAG };
});
