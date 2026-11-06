// Wires src/features/mismatchSearch.js into OVE's find tool.
//
// scripts/patch-ove.js makes the editor's search-layer selector call
// window.oveMismatchFind.searchLayers() whenever "mismatches allowed" is set
// above zero, and makes the find bar render window.oveMismatchFind.control().
// The setting lives in the editor's own findTool state (findTool.oveMismatches)
// so it is per-document, survives closing the bar, and — the practical reason —
// is an input to the memoised selector, so changing it recomputes the hits.
(function () {
  const MAX = 5;

  function searchLayers(sequence, searchString, options) {
    const search = window.oveMismatchSearch;
    if (!search) return [];
    const matches = search.findMatches(sequence, searchString, options);
    const hits = [];
    const marks = [];
    matches.forEach((match) => {
      const title = search.describe(match);
      hits.push({
        start: match.start,
        end: match.end,
        forward: !match.bottomStrand,
        isSearchLayer: true,
        customTitle: title,
        oveMismatchCount: match.mismatchCount,
        className:
          "veSearchLayer" +
          (match.bottomStrand ? " veSearchLayerBottomStrand" : "") +
          (match.mismatchCount ? " oveSearchFuzzy" : ""),
      });
      match.mismatches.forEach((m) => {
        marks.push({
          start: m.index,
          end: m.index,
          forward: !match.bottomStrand,
          isSearchLayer: true,
          oveMismatchMark: true,
          customTitle: title,
          className: "veSearchLayer oveSearchMismatch",
        });
      });
    });
    // hits first: the editor numbers matches by position in this array, and
    // the marks have to paint over the hits they sit inside
    const layers = hits.concat(marks);
    window.__oveLastSearchLayers = layers;
    return layers;
  }

  const editor = () => {
    const doc = window.oveTabs && window.oveTabs.getActive();
    return doc && doc.editor;
  };

  function findToolState() {
    try {
      return editor().getState().findTool || {};
    } catch (e) {
      return {};
    }
  }

  function setAllowed(n) {
    const ed = editor();
    if (ed) ed.updateEditor({ findTool: { oveMismatches: n, matchNumber: 0 } });
  }

  // The active hit's own description. Knowing a hit is approximate is no use
  // without knowing where it differs, so this rides next to the find bar's
  // match counter, where it is visible in both the inline and expanded bars.
  function activeDescription(state) {
    try {
      const layers = window.__oveLastSearchLayers || [];
      const hitsOnly = layers.filter((l) => !l.oveMismatchMark);
      const hit = hitsOnly[state.matchNumber || 0];
      return hit ? hit.customTitle : null;
    } catch (e) {
      return null;
    }
  }

  // Rendered into the find bar's options row by a patch (see patch-ove.js).
  function control(React) {
    const h = React.createElement;
    const state = findToolState();
    const value = state.oveMismatches || 0;
    const options = [];
    for (let i = 0; i <= MAX; i++) {
      options.push(
        h("option", { key: i, value: i }, i === 0 ? "Exact" : `≤ ${i} mismatch${i > 1 ? "es" : ""}`)
      );
    }
    return h(
      "div",
      { key: "oveMismatches", className: "ove-mismatch-find" },
      h(
        "div",
        { className: "bp3-html-select bp3-small" },
        h(
          "select",
          {
            value,
            title: "How many mismatched bases a hit may have",
            onChange: (e) => setAllowed(Number(e.target.value)),
          },
          options
        ),
        h("span", { className: "bp3-icon bp3-icon-standard bp3-icon-double-caret-vertical" })
      )
    );
  }

  // Rendered beside the find bar's "3/96" counter by a patch.
  function activeDetail(React) {
    const state = findToolState();
    if (!state.oveMismatches) return null;
    const description = activeDescription(state);
    if (!description) return null;
    return React.createElement(
      "span",
      { key: "oveMismatchDetail", className: "ove-mismatch-detail", title: description },
      description
    );
  }

  window.oveMismatchFind = { searchLayers, control, activeDetail, setAllowed, MAX };
})();
