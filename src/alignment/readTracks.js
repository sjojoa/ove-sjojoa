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

  let run = null; // { results, template, reads, merge } from the last alignment
  let order = []; // which of run.results are on screen, in track order
  let hidden = []; // the ones taken out, in the order they were taken out
  let selected = null; // track index of the selected read, or null

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
          ...annotationsFor(shown(), selected),
        ],
      },
    });
  }

  // The reads on screen, in the order their tracks are drawn, so a track index
  // means the same thing to the map, the name chips and the alignment itself.
  const shown = () => order.map((i) => run.results[i]);

  function show(payload) {
    run = payload || null;
    order = ((payload && payload.results) || []).map((_, i) => i);
    hidden = [];
    selected = null;
    paint(editorFor(payload && payload.template));
  }

  // --- taking a read out of the alignment ----------------------------------
  //
  // Hiding a read is not a matter of not drawing it: a base the read has and
  // the plasmid does not holds a column open across every row, and once that
  // read is gone the column should close up again if nothing else needs it.
  // So the alignment is merged again from the reads that are left and handed
  // back to OVE, which recomputes the mismatches from it.
  function alignmentId() {
    const editor = window.editor && window.editor.getState ? window.editor : null;
    if (!editor) return null;
    const panel = (editor.getState().panelsShown || [])
      .flat()
      .find((p) => p.type === "alignment" && p.active);
    return panel ? panel.id : null;
  }

  function rebuild() {
    const editor = window.editor && window.editor.addAlignment ? window.editor : null;
    const id = alignmentId();
    if (!run || !run.merge || !editor || !id) return false;
    const { refRow, readRows } = run.merge(shown());
    const track = (seq, name, sequence) => ({
      sequenceData: seq,
      alignmentData: { name, sequence },
      chromatogramData: seq.chromatogramData,
    });
    editor.addAlignment({
      id,
      alignmentTracks: [
        track(run.template, `0_${run.template.name}`, refRow),
        ...order.map((i, k) => track(run.reads[i], `${k + 1}_${run.reads[i].name}`, readRows[k])),
      ],
    });
    paint(editorFor(run.template));
    return true;
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
      const res = shown()[trackIndex - 1];
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
          title: "Take this read out of the alignment",
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            const was = order.slice();
            hidden.push(order[trackIndex - 1]);
            order = order.filter((_, k) => k !== trackIndex - 1);
            selected = null;
            if (!rebuild()) {
              order = was;
              hidden.pop();
            }
          },
        })
      );
    }
    return items;
  }

  // Give the alignment the whole window instead of sharing it with the map,
  // and put it back. OVE keeps its panels as groups, one group per split.
  let split = null;
  function topBar(React) {
    const items = [];
    if (hidden.length) {
      const names = hidden.map((i) => (run && run.reads[i] && run.reads[i].name) || `read ${i + 1}`);
      items.push(
        chip(React, {
          key: "unhide",
          label: `${hidden.length} hidden \u21ba`,
          title: `Put back: ${names.join(", ")}`,
          onClick: (e) => {
            e.preventDefault();
            const was = { order, hidden };
            order = run.results.map((_, i) => i);
            hidden = [];
            if (!rebuild()) {
              order = was.order;
              hidden = was.hidden;
            }
          },
        })
      );
    }
    items.push(fullWindowButton(React));
    return items;
  }

  function fullWindowButton(React) {
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

  return { PREFIX, RED, BLUE, idFor, annotationsFor, strip, show, select, controls, topBar, rebuild };
});
