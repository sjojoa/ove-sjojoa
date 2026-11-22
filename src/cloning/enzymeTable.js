// Deciding which enzymes the map should show.
//
// Two jobs. One: pick the enzymes worth looking at -- the ones that cut once,
// or cut once with a long enough site to be worth ordering. Two: let you keep
// an enzyme on the map that does NOT cut, so that if a mutation or an
// assembly ever creates that site, it appears where you will see it.
//
// Pure: the caller does the cutting and passes counts in.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveEnzymeTable = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // N in a recognition site specifies nothing, so AlwNI's CAGNNNCTG is a
  // six-base cutter, not a nine-base one.
  function specificity(site) {
    return ((site || "").toUpperCase().match(/[^N]/g) || []).length;
  }

  // A Type IIS enzyme cuts outside its recognition sequence, which is what
  // makes Golden Gate work and what makes its map label misleading. The
  // database does not flag it, but the snip offsets say so plainly.
  function cutsOutsideSite(enzyme) {
    const n = (enzyme.site || "").length;
    const out = (x) => x !== undefined && (x > n || x < 0);
    return out(enzyme.topSnipOffset) || out(enzyme.bottomSnipOffset);
  }

  // The enzymes a Golden Gate assembly is built from: Type IIS, cutting far
  // enough out to leave a four-base overhang you choose.
  const GOLDEN_GATE = ["bsai", "bsmbi", "esp3i", "bbsi", "bpii", "sapi", "lgui", "bspqi", "aari", "btgzi", "bsmfi", "paqci", "bveI"];

  function overhangOf(enzyme) {
    const top = enzyme.topSnipOffset;
    const bottom = enzyme.bottomSnipOffset;
    if (top === undefined || bottom === undefined || top === bottom) return "blunt";
    return top < bottom ? "5′" : "3′";
  }

  // One row of the table. `positions` are 1-based cut positions.
  function row(enzyme, positions) {
    const site = (enzyme.site || "").toUpperCase();
    return {
      name: enzyme.name,
      key: String(enzyme.name).toLowerCase(),
      site: site,
      specificity: specificity(site),
      overhang: overhangOf(enzyme),
      isType2S: cutsOutsideSite(enzyme),
      cuts: positions.length,
      positions: positions,
      top: enzyme.topSnipOffset,
      bottom: enzyme.bottomSnipOffset,
      aliases: [],
    };
  }

  // The database carries every isoschizomer as its own entry, which turns a
  // readable table into hundreds of rows saying the same thing. Enzymes that
  // recognise the same site and cut it in the same place share a row; the
  // one you are likeliest to have in the freezer leads it.
  function groupIsoschizomers(rows, { preferred = [], sells, sold } = {}) {
    const rank = {};
    preferred.forEach((n, i) => (rank[String(n).toLowerCase()] = i));
    // the name to lead with is the one you could order: your supplier's
    // first, then anyone's, then whatever the database calls it
    const score = (r) => {
      if (sells && sells(r.name)) return rank[r.key] !== undefined ? rank[r.key] : 100 + r.name.length;
      if (sold && sold(r.name)) return 1000 + r.name.length;
      return rank[r.key] !== undefined ? 2000 + rank[r.key] : 3000 + r.name.length;
    };
    const groups = new Map();
    (rows || []).forEach((r) => {
      const id = `${r.site}|${r.top}|${r.bottom}`;
      const found = groups.get(id);
      if (!found) groups.set(id, [r]);
      else found.push(r);
    });
    return [...groups.values()].map((members) => {
      const sorted = members.slice().sort((a, b) => score(a) - score(b));
      return { ...sorted[0], aliases: sorted.slice(1).map((m) => m.name) };
    });
  }

  const isGoldenGate = (r) =>
    GOLDEN_GATE.includes(r.key) || (r.aliases || []).some((a) => GOLDEN_GATE.includes(String(a).toLowerCase()));

  const FILTERS = [
    { value: "one-long", label: "1 site, 6 bp or longer", test: (r) => r.cuts === 1 && r.specificity >= 6 },
    { value: "one", label: "1 site", test: (r) => r.cuts === 1 },
    { value: "one-two", label: "1 or 2 sites", test: (r) => r.cuts === 1 || r.cuts === 2 },
    { value: "two", label: "2 sites", test: (r) => r.cuts === 2 },
    { value: "none", label: "does not cut", test: (r) => r.cuts === 0 },
    { value: "long", label: "6 bp or longer", test: (r) => r.specificity >= 6 },
    { value: "type2s", label: "Type IIS", test: (r) => r.isType2S },
    { value: "goldengate", label: "Golden Gate", test: isGoldenGate },
    { value: "any", label: "any number", test: () => true },
  ];

  function matches(r, { query = "", cuts = "any", selected = {} } = {}) {
    const q = query.trim().toUpperCase();
    if (q && !r.name.toUpperCase().includes(q) && !r.site.includes(q) && !(r.aliases || []).some((a) => a.toUpperCase().includes(q))) return false;
    // an enzyme you have chosen stays visible whatever the filter says, or it
    // would vanish the moment it stops cutting -- which is the case you chose
    // it for
    if (selected[r.key]) return true;
    const f = FILTERS.find((x) => x.value === cuts) || FILTERS[FILTERS.length - 1];
    return f.test(r);
  }

  function filter(rows, options) {
    return (rows || []).filter((r) => matches(r, options));
  }

  // What OVE's map filter wants: one entry per chosen enzyme, lowercased.
  function toMapFilter(selected) {
    return Object.keys(selected || {})
      .filter((k) => selected[k])
      .map((k) => ({ value: k, label: k }));
  }

  return { specificity, overhangOf, cutsOutsideSite, isGoldenGate, row, matches, filter, groupIsoschizomers, toMapFilter, FILTERS, GOLDEN_GATE };
});
