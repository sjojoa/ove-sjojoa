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

  // --- the controls on a track's name chip ---------------------------------
  //
  // Collapsing a trace and hiding a read are both answers to "there is too
  // much on screen", and neither needs OVE to re-render: they are classes on
  // the track's own row, and the CSS in style.css does the rest. A hidden read
  // keeps its name chip, so the same button brings it back.
  const TRACK = ".alignmentViewTrackContainer";
  const rowOf = (e) => e.currentTarget.closest(TRACK);

  function toggle(e, className) {
    e.preventDefault();
    e.stopPropagation();
    const row = rowOf(e);
    if (row) row.classList.toggle(className);
  }

  function chip(React, { onClick, title, label, key }) {
    return React.createElement(
      "span",
      { className: "ove-track-btn", onClick, title, key, role: "button" },
      label
    );
  }

  // Called from the patched AlignmentView. React is passed in because this file
  // is a plain script with no bundler.
  function controls(React, trackIndex, name, isTemplate) {
    const items = [];
    if (!isTemplate) {
      const res = current[trackIndex - 1];
      const reversed = res ? res.reversed : /\(rev-comp\)/.test(name || "");
      items.push(
        React.createElement(
          "span",
          {
            className: "ove-track-arrow",
            key: "arrow",
            title: reversed ? "read on the bottom strand" : "read on the top strand",
          },
          reversed ? "\u25c0" : "\u25b6"
        )
      );
    }
    items.push(
      chip(React, {
        key: "trace",
        label: "\u223f",
        title: "Show or hide this chromatogram",
        onClick: (e) => toggle(e, "ove-track-collapsed"),
      })
    );
    if (!isTemplate) {
      items.push(
        chip(React, {
          key: "hide",
          label: "\u2013",
          title: "Hide or show this read",
          onClick: (e) => toggle(e, "ove-track-hidden"),
        })
      );
    }
    return items;
  }

  // Give the alignment the whole window instead of sharing it with the map,
  // and put it back. OVE keeps its panels as groups, one group per split.
  let split = null;
  function topBar(React) {
    return chip(React, {
      key: "fullwindow",
      label: "\u2922",
      title: "Give the alignment the whole window",
      onClick: (e) => {
        e.preventDefault();
        const editor = window.editor && window.editor.getState ? window.editor : null;
        if (!editor) return;
        const groups = editor.getState().panelsShown || [];
        if (groups.length > 1) {
          split = groups;
          // every panel ends up in one group, so only one of them can be the
          // open tab: keep the one the alignment's own half had open
          const keep = (groups[0] || []).find((pane) => pane.active);
          editor.updateEditor({
            panelsShown: [
              groups.flat().map((pane) => ({ ...pane, active: !!keep && pane.id === keep.id })),
            ],
          });
        } else if (split) {
          editor.updateEditor({ panelsShown: split });
          split = null;
        }
      },
    });
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      if (!e.target.closest) return;
      if (e.target.closest(".ove-track-btn")) return; // a row control, not a selection
      const el = e.target.closest(".alignmentTrackName");
      if (!el) return;
      const row = el.closest("[data-alignment-track-index]");
      const idx = row && Number(row.getAttribute("data-alignment-track-index"));
      if (idx) select(idx);
    });
  }

  return { PREFIX, RED, BLUE, idFor, annotationsFor, strip, show, select, controls, topBar };
});
