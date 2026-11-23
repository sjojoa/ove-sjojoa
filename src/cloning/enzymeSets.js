// Named enzyme sets you keep: "my screening panel", "Golden Gate", the six
// enzymes your bench actually owns.
//
// The per-file set (enzymeSet.js) answers "what matters for this plasmid".
// This answers "what I always look at", so it lives with you rather than
// with any one sequence.
//
// Pure apart from the store, which is passed in: localStorage in the app, a
// plain object in tests.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveEnzymeSets = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const KEY = "ove-enzyme-sets";

  // A broken or absent store is not worth failing over: you lose your sets,
  // not your sequence.
  function readAll(store) {
    try {
      const raw = store && store.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeAll(store, sets) {
    try {
      store.setItem(KEY, JSON.stringify(sets));
      return true;
    } catch (e) {
      return false;
    }
  }

  const clean = (names) => [...new Set((names || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean))].sort();

  // Saving under an existing name replaces it, which is what "save" means
  // when you are editing a panel.
  function save(store, name, names) {
    const label = String(name || "").trim();
    if (!label) return readAll(store);
    const sets = readAll(store);
    sets[label] = clean(names);
    writeAll(store, sets);
    return sets;
  }

  function remove(store, name) {
    const sets = readAll(store);
    delete sets[String(name || "").trim()];
    writeAll(store, sets);
    return sets;
  }

  const get = (store, name) => readAll(store)[String(name || "").trim()] || [];

  const names = (store) => Object.keys(readAll(store)).sort((a, b) => a.localeCompare(b));

  return { KEY, readAll, save, remove, get, names, clean };
});
