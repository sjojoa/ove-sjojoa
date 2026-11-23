// The same reads, on the map as well as in the alignment.
//
// An alignment answers "where does this read sit on my plasmid", and that is a
// question about the map as much as about the bases. So every read that lines
// up gets drawn over the template as an arrow pointing the way it was
// sequenced -- red, with the one you have selected in blue -- and the
// alignment panel's own track names get the same arrow and the same two
// colours, so switching between the Map and the alignment shows one thing
// twice rather than two unrelated pictures.
//
// They go in as `lineageAnnotations`, which is OVE's own annotation type for
// things that belong to a view rather than to the sequence: it draws them on
// both the circular and the linear map, it is not part of the unsaved-changes
// fingerprint, and `strip` takes them back out before a file is written. A
// read is not a feature of the plasmid and must never be saved as one.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveReadTracks = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PREFIX = "ove-read-";
  const RED = "#C23030";
  const BLUE = "#3FA6DA";

  // Track 0 of an alignment is the template, so read i of the alignment is
  // track i + 1 and the arrows have to be numbered the same way.
  const idFor = (trackIndex) => `${PREFIX}${trackIndex}`;

  // `results` are the aligner's per-read results, in track order.
  function annotationsFor(results, selected) {
    return (results || [])
      .map((res, idx) => {
        if (!res || res.refStart === undefined || res.refStart === null) return null;
        const track = idx + 1;
        return {
          id: idFor(track),
          name: res.name || `read ${track}`,
          type: "misc_feature",
          start: res.refStart,
          end: res.refEnd,
          // a reverse read was reverse-complemented to align, so it was read
          // along the bottom strand
          forward: !res.reversed,
          strand: res.reversed ? -1 : 1,
          color: track === selected ? BLUE : RED,
          notes: {},
        };
      })
      .filter(Boolean);
  }

  function strip(sequenceData) {
    const anns = sequenceData && sequenceData.lineageAnnotations;
    if (!anns) return sequenceData;
    const kept = Object.values(anns).filter((a) => !(a.id || "").startsWith(PREFIX));
    return {
      ...sequenceData,
      lineageAnnotations: kept,
    };
  }

  // --- browser side -------------------------------------------------------

  let current = []; // the results of the alignment now on screen
  let selected = null; // track index, or null

  function editorFor(template) {
    const editor = typeof window !== "undefined" && window.editor;
    if (!editor || !editor.getState) return null;
    // the alignment tool lets you pick any sequence as the template; only draw
    // on the map when the map is the thing the reads were aligned to
    const sd = editor.getState().sequenceData || {};
    if (!template || (sd.sequence || "").length !== (template.sequence || "").length) return null;
    return editor;
  }

  function paint(editor) {
    if (!editor) return;
    const sd = editor.getState().sequenceData || {};
    editor.updateEditor({
      sequenceData: {
        ...sd,
        lineageAnnotations: [
          ...Object.values(sd.lineageAnnotations || {}).filter(
            (a) => !(a.id || "").startsWith(PREFIX)
          ),
          ...annotationsFor(current, selected),
        ],
      },
    });
  }

  function show(results, template) {
    current = results || [];
    selected = null;
    paint(editorFor(template));
  }

  function select(trackIndex) {
    selected = trackIndex === selected ? null : trackIndex;
    const editor = window.editor && window.editor.getState ? window.editor : null;
    if (editor) paint(editorFor({ sequence: (editor.getState().sequenceData || {}).sequence }));
    document.querySelectorAll(".alignmentTrackNameDiv.ove-track-selected").forEach((el) => {
      el.classList.remove("ove-track-selected");
    });
    if (selected === null) return;
    const el = document.querySelector(`.ove-track-read-${selected}`);
    if (el) el.classList.add("ove-track-selected");
  }

  // The arrow drawn next to a track's name in the alignment panel. Called from
  // the patched AlignmentView; React is passed in because this file is a plain
  // script with no bundler.
  function arrow(React, trackIndex, name, isTemplate) {
    if (isTemplate) return null;
    const res = current[trackIndex - 1];
    const reversed = res ? res.reversed : /\(rev-comp\)/.test(name || "");
    return React.createElement(
      "span",
      { className: "ove-track-arrow", title: reversed ? "read on the bottom strand" : "read on the top strand" },
      reversed ? "◀" : "▶"
    );
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const el = e.target.closest && e.target.closest(".alignmentTrackName");
      if (!el) return;
      const row = el.closest("[data-alignment-track-index]");
      const idx = row && Number(row.getAttribute("data-alignment-track-index"));
      if (idx) select(idx);
    });
  }

  return { PREFIX, RED, BLUE, idFor, annotationsFor, strip, show, select, arrow };
});
