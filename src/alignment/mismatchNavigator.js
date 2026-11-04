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

  // Select the same reference bases in the main editor, so the Sequence Map
  // (right panel) scrolls to the mismatch too.
  // range = alignment columns {start, end}; caret = a cursor column (between bases)
  function syncReference(view, range, caret) {
    try {
      const ed = typeof editor !== "undefined" ? editor : null; // global from renderer.js
      const tracks = view.props.alignmentTracks;
      if (!ed || !tracks || !tracks.length) return;
      // only when the main editor shows this same reference sequence
      const main = ed.getState().sequenceData || {};
      const refSeq = (tracks[0].sequenceData && tracks[0].sequenceData.sequence) || "";
      if (!refSeq.length || (main.sequence || "").length !== refSeq.length) return;
      const { refOfCol } = columnMaps(tracks);
      if (caret !== undefined) {
        // cursor goes before the first reference base at or after this column
        let pos = refSeq.length;
        for (let c = Math.max(0, caret); c < refOfCol.length; c++) if (refOfCol[c] > -1) { pos = refOfCol[c]; break; }
        ed.updateEditor({ caretPosition: pos, selectionLayer: { start: -1, end: -1 } });
        return;
      }
      let start = -1, end = -1;
      for (let c = range.start; c <= range.end; c++) {
        if (refOfCol[c] > -1) {
          if (start < 0) start = refOfCol[c];
          end = refOfCol[c];
        }
      }
      if (start < 0) for (let c = range.start; c >= 0 && start < 0; c--) if (refOfCol[c] > -1) start = end = refOfCol[c];
      if (start < 0) return;
      ed.updateEditor({ selectionLayer: { start, end }, caretPosition: -1 });
    } catch (e) {
      console.warn("could not sync the sequence map", e);
    }
  }

  // Called on every render of the alignment's top bar: mirror a new cursor or
  // selection (from clicking/dragging in the alignment) into the Sequence Map.
  function followSelection(view) {
    const { selectionLayer, caretPosition } = view.props;
    const sel = selectionLayer && selectionLayer.start > -1 ? `${selectionLayer.start}-${selectionLayer.end}` : "";
    const key = sel ? `s${sel}` : caretPosition > -1 ? `c${caretPosition}` : "";
    const nav = (view.__oveNav = view.__oveNav || {});
    if (nav.lastSynced === undefined) {
      nav.lastSynced = key; // don't jump the Sequence Map just because the tab was opened
      return;
    }
    if (!key || key === nav.lastSynced) return;
    nav.lastSynced = key;
    setTimeout(() => (sel ? syncReference(view, { start: selectionLayer.start, end: selectionLayer.end }) : syncReference(view, null, caretPosition)), 0);
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
    jumpTo(view, target); // the Sequence Map follows via followSelection
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

  // ---------------------------------------------- what a mismatch affects
  const CODONS = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L", ATT: "I", ATC: "I", ATA: "I", ATG: "M",
    GTT: "V", GTC: "V", GTA: "V", GTG: "V", TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A", TAT: "Y", TAC: "Y", TAA: "*", TAG: "*",
    CAT: "H", CAC: "H", CAA: "Q", CAG: "Q", AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R", AGT: "S", AGC: "S", AGA: "R", AGG: "R",
    GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  };
  const AA3 = { A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", Q: "Gln", E: "Glu", G: "Gly", H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val", "*": "Ter" };
  const COMP = { A: "T", T: "A", G: "C", C: "G" };
  const rc = (x) => x.split("").reverse().map((c) => COMP[c] || "N").join("");

  // column <-> reference index maps for the template track
  const colMapCache = new WeakMap();
  function columnMaps(tracks) {
    if (!colMapCache.has(tracks)) {
      const t = tracks[0].alignmentData.sequence;
      const colOfRef = [];
      const refOfCol = new Int32Array(t.length).fill(-1);
      for (let col = 0; col < t.length; col++) {
        if (t[col] !== "-") {
          refOfCol[col] = colOfRef.length;
          colOfRef.push(col);
        }
      }
      colMapCache.set(tracks, { colOfRef, refOfCol });
    }
    return colMapCache.get(tracks);
  }

  const asArray = (x) => (Array.isArray(x) ? x : Object.values(x || {}));
  const inFeature = (f, i, n) => (f.start <= f.end ? i >= f.start && i <= f.end : i >= f.start || i <= f.end) && i < n;
  const isCoding = (f) => /^cds$/i.test(f.type || "");

  // Describe the mismatch range [start, end] (alignment columns) for one read track
  function describeMismatch(tracks, range) {
    const template = tracks[0];
    const sd = template.sequenceData || {};
    const ref = (sd.sequence || "").toUpperCase();
    const n = ref.length;
    const { colOfRef, refOfCol } = columnMaps(tracks);
    // reference positions touched by this range (an insertion touches the base before it)
    let refStart = -1, refEnd = -1;
    for (let c = range.start; c <= range.end; c++) {
      if (refOfCol[c] > -1) {
        if (refStart < 0) refStart = refOfCol[c];
        refEnd = refOfCol[c];
      }
    }
    let insertion = false;
    if (refStart < 0) {
      insertion = true;
      for (let c = range.start; c >= 0; c--) if (refOfCol[c] > -1) { refStart = refEnd = refOfCol[c]; break; }
      if (refStart < 0) refStart = refEnd = 0;
    }
    // first read that differs here
    const read = tracks.slice(1).find((tr) => {
      const s = tr.alignmentData.sequence.toUpperCase();
      for (let c = range.start; c <= range.end; c++) if (s[c] !== template.alignmentData.sequence.toUpperCase()[c]) return true;
      return false;
    }) || tracks[1];
    const readAln = read.alignmentData.sequence.toUpperCase();
    const refAln = template.alignmentData.sequence.toUpperCase();
    const refBases = refAln.slice(range.start, range.end + 1).replace(/-/g, "");
    const readBases = readAln.slice(range.start, range.end + 1).replace(/-/g, "");
    const delta = readBases.length - refBases.length;

    const feats = asArray(sd.features).filter((f) => inFeature(f, refStart, n) || inFeature(f, refEnd, n));
    const parts = feats.map((f) => {
      let text = `${f.name || "feature"}${f.type ? ` (${f.type})` : ""}`;
      if (isCoding(f) && n) {
        const forward = f.forward !== false && f.strand !== -1;
        const len = f.start <= f.end ? f.end - f.start + 1 : n - f.start + f.end + 1;
        const offsetOf = (i) => (forward ? (i - f.start + n) % n : (f.end - i + n) % n); // 0-based within CDS
        const cdsPos = offsetOf(forward ? refStart : refEnd) + 1;
        if (delta !== 0) {
          const kind = delta % 3 === 0 ? `in-frame ${delta > 0 ? "insertion" : "deletion"} of ${Math.abs(delta) / 3} aa` : `frameshift (${delta > 0 ? "+" : ""}${delta} bp)`;
          text += `: c.${cdsPos}, ${kind}`;
        } else if (cdsPos >= 1 && cdsPos <= len) {
          // substitution: compare codon(s) of reference and read
          const codonIndex = Math.floor((cdsPos - 1) / 3);
          const codonRefIdx = [0, 1, 2].map((k) => {
            const off = codonIndex * 3 + k;
            return forward ? (f.start + off) % n : (f.end - off + n) % n;
          });
          const refCodonTop = codonRefIdx.map((i) => ref[i]).join("");
          const readCodonTop = codonRefIdx.map((i) => readAln[colOfRef[i]] || "-").join("");
          const refCodon = forward ? refCodonTop : rc(refCodonTop);
          const readCodon = forward ? readCodonTop : rc(readCodonTop);
          const aaRef = CODONS[refCodon] || "?";
          const aaRead = /-/.test(readCodon) ? "?" : CODONS[readCodon] || "?";
          const refBase = forward ? refBases : rc(refBases);
          const readBase = forward ? readBases : rc(readBases);
          const cdna = `c.${cdsPos}${refBases.length > 1 ? `_${cdsPos + refBases.length - 1}` : ""}${refBase}>${readBase}`;
          const p =
            aaRef === aaRead
              ? `p.${AA3[aaRef] || aaRef}${codonIndex + 1}= (silent)`
              : `p.${AA3[aaRef] || aaRef}${codonIndex + 1}${AA3[aaRead] || aaRead}${aaRead === "*" ? " (nonsense)" : ""}`;
          text += `: ${cdna} · ${p}`;
        }
      }
      return text;
    });
    const where = `ref ${refStart + 1}${refEnd > refStart ? `–${refEnd + 1}` : ""}`;
    const what = insertion ? `insertion of ${readBases.length} bp` : delta < 0 && !readBases.length ? `deletion of ${refBases.length} bp` : null;
    return { where, what, features: parts, read: read.sequenceData && read.sequenceData.name };
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

  function infoLine(h, tracks, range) {
    let d;
    try {
      d = describeMismatch(tracks, range);
    } catch (e) {
      console.error("describeMismatch", e);
      return null;
    }
    const text = [d.where, d.what, d.features.length ? `in ${d.features.join("; ")}` : "not in an annotated feature"].filter(Boolean).join(" · ");
    return h("div", { key: "info", className: "ove-mismatch-info", title: text }, text);
  }

  function renderMismatchNav(React, view) {
    const { alignmentTracks, isInPairwiseOverviewView, selectionLayer } = view.props;
    if (!alignmentTracks || !alignmentTracks.length) return null;
    const h = React.createElement;
    const slider = positionSlider(React, view, alignmentTracks);
    if (!isInPairwiseOverviewView) followSelection(view);
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
      ...slider,
      idx > -1 ? infoLine(h, alignmentTracks, ranges[idx]) : null
    );
  }

  const api = { findMismatchRanges, renderMismatchNav, refPositions, describeMismatch };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.oveRenderMismatchNav = renderMismatchNav;
})();
