// "Previous / next mismatch" buttons for OVE's alignment view.
// scripts/patch-ove.js makes the alignment top bar call
// window.oveRenderMismatchNav(React, alignmentViewComponent).
//
// A mismatch is any alignment column where a non-template track differs from
// the template (track 0), counting gaps (indels) but ignoring the unsequenced
// regions before/after each read. Adjacent mismatch columns are grouped, so an
// indel of several bases is a single stop.
(function () {
  function findMismatchRanges(tracks) {
    if (!tracks || tracks.length < 2) return [];
    const template = tracks[0].alignmentData.sequence.toLowerCase();
    const isMismatch = new Uint8Array(template.length);
    for (let t = 1; t < tracks.length; t++) {
      const seq = tracks[t].alignmentData.sequence.toLowerCase();
      const first = seq.search(/[^-]/);
      if (first === -1) continue;
      const last = seq.length - 1 - seq.split("").reverse().join("").search(/[^-]/);
      for (let col = first; col <= last; col++) {
        if (seq[col] !== template[col]) isMismatch[col] = 1;
      }
    }
    const ranges = [];
    for (let col = 0; col < isMismatch.length; col++) {
      if (!isMismatch[col]) continue;
      const prev = ranges[ranges.length - 1];
      if (prev && prev.end === col - 1) prev.end = col;
      else ranges.push({ start: col, end: col });
    }
    return ranges;
  }

  const cache = new WeakMap(); // tracks array -> mismatch ranges
  function getRanges(tracks) {
    if (!cache.has(tracks)) cache.set(tracks, findMismatchRanges(tracks));
    return cache.get(tracks);
  }

  // Read from props (redux) first: after a tab switch the remounted view's
  // easyStore starts empty even though the selection is still shown.
  function currentRange(view) {
    const { selectionLayer, caretPosition } = view.props;
    const sel = selectionLayer && selectionLayer.start > -1 ? selectionLayer : view.easyStore.selectionLayer || {};
    if (sel.start > -1) return { start: sel.start, end: sel.end };
    const caret = caretPosition > -1 ? caretPosition : view.easyStore.caretPosition;
    return caret > -1 ? { start: caret, end: caret - 1 } : null;
  }

  function jumpTo(view, range) {
    view.updateSelectionOrCaret(false, range, { forceReduxUpdate: true });
    const holder = view.alignmentHolder;
    if (!holder) return;
    const charWidth = view.getCharWidthInLinearView();
    const visibleWidth = holder.clientWidth - (view.state.nameDivWidth || 0);
    const targetLeft = range.start * charWidth - visibleWidth / 2;
    const maxScroll = holder.scrollWidth - holder.clientWidth;
    if (maxScroll > 0) view.scrollAlignmentToPercent(targetLeft / maxScroll);
  }

  function step(view, ranges, direction) {
    if (!ranges.length) return;
    const cur = currentRange(view);
    let target;
    if (direction > 0) {
      target = cur ? ranges.find((r) => r.start > cur.end) : ranges[0];
      if (!target) target = ranges[0]; // wrap around
    } else {
      const before = cur ? ranges.filter((r) => r.end < cur.start) : [];
      target = before.length ? before[before.length - 1] : ranges[ranges.length - 1];
    }
    jumpTo(view, target);
  }

  // reference (template) coordinate for every alignment column
  const refPosCache = new WeakMap();
  function refPositions(tracks) {
    if (!refPosCache.has(tracks)) {
      const template = tracks[0].alignmentData.sequence;
      const pos = new Int32Array(template.length);
      let count = 0;
      for (let col = 0; col < template.length; col++) {
        if (template[col] !== "-") count++;
        pos[col] = Math.max(count, 1);
      }
      refPosCache.set(tracks, pos);
    }
    return refPosCache.get(tracks);
  }

  // keep the slider and position readout in sync with the alignment's scroll.
  // OVE can swap the scroll container element, so listen once on the document
  // (capture phase) and map whichever container scrolled back to its view.
  const holderToView = new WeakMap();
  let captureInstalled = false;
  function syncPosition(view) {
    const nav = view.__oveNav;
    const holder = view.alignmentHolder;
    if (!nav || !holder || !nav.tracks) return;
    const maxScroll = holder.scrollWidth - holder.clientWidth;
    const pct = maxScroll > 0 ? holder.scrollLeft / maxScroll : 0;
    if (nav.slider && !nav.dragging) nav.slider.value = String(Math.round(pct * 1000));
    if (nav.label) {
      const pos = refPositions(nav.tracks);
      const charWidth = view.getCharWidthInLinearView();
      const visibleWidth = holder.clientWidth - (view.state.nameDivWidth || 0);
      const col = Math.min(pos.length - 1, Math.max(0, Math.floor((holder.scrollLeft + visibleWidth / 2) / charWidth)));
      nav.label.textContent = `Position ${pos[col].toLocaleString()} / ${pos[pos.length - 1].toLocaleString()}`;
    }
  }
  function watchScroll(view) {
    if (view.alignmentHolder) holderToView.set(view.alignmentHolder, view);
    if (captureInstalled) return;
    captureInstalled = true;
    document.addEventListener(
      "scroll",
      (e) => {
        const v = holderToView.get(e.target);
        if (v) syncPosition(v);
      },
      { capture: true, passive: true }
    );
  }

  function positionSlider(React, view, tracks) {
    view.__oveNav = view.__oveNav || {};
    view.__oveNav.tracks = tracks;
    const h = React.createElement;
    return [
      h("input", {
        key: "slider",
        type: "range",
        min: 0,
        max: 1000,
        step: 1,
        defaultValue: Math.round((view.easyStore.percentScrolled || 0) * 1000),
        title: "Drag to move through the alignment",
        className: "ove-align-slider",
        ref: (el) => {
          view.__oveNav.slider = el;
          if (el) setTimeout(() => {
            watchScroll(view);
            syncPosition(view);
          }, 0);
        },
        onChange: (e) => view.scrollAlignmentToPercent(Number(e.target.value) / 1000),
        onMouseDown: () => {
          view.__oveNav.dragging = true;
          window.addEventListener("mouseup", () => (view.__oveNav.dragging = false), { once: true });
        },
      }),
      h("span", { key: "pos", className: "ove-align-pos", ref: (el) => (view.__oveNav.label = el) }),
    ];
  }

  function renderMismatchNav(React, view) {
    const { alignmentTracks, isInPairwiseOverviewView, selectionLayer } = view.props;
    if (!alignmentTracks || !alignmentTracks.length) return null;
    const h = React.createElement;
    const slider = positionSlider(React, view, alignmentTracks);
    if (isInPairwiseOverviewView || alignmentTracks.length < 2) {
      return h("div", { className: "ove-align-nav" }, ...slider);
    }
    const ranges = getRanges(alignmentTracks);
    const sel = selectionLayer || {};
    const idx = ranges.findIndex((r) => r.start === sel.start && r.end === sel.end);
    const button = (icon, title, direction) =>
      h(
        "button",
        {
          type: "button",
          className: "bp3-button bp3-minimal bp3-small",
          title,
          disabled: !ranges.length,
          onClick: () => step(view, ranges, direction),
        },
        h("span", { className: `bp3-icon-standard bp3-icon-${icon}` })
      );
    return h(
      "div",
      { className: "ove-align-nav ove-mismatch-nav" },
      button("chevron-left", "Previous mismatch", -1),
      h(
        "span",
        { style: { fontSize: 12, margin: "0 4px" }, className: "ove-mismatch-count" },
        ranges.length
          ? `Mismatch ${idx > -1 ? idx + 1 : "–"} / ${ranges.length}`
          : "No mismatches"
      ),
      button("chevron-right", "Next mismatch", 1),
      h("span", { style: { width: 10 } }),
      ...slider
    );
  }

  const api = { findMismatchRanges, renderMismatchNav, refPositions };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.oveRenderMismatchNav = renderMismatchNav;
})();
