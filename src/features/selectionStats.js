// Tm and GC content for whatever is selected on the map.
//
// Both numbers already existed upstream and were simply switched off: GC
// content inside getSelectionMessage behind a `showGCContent` flag, Tm as a
// separate status bar item behind `showMeltingTemp`. Turning them on as they
// stand is not enough, because upstream's Tm disagrees with this fork's by
// about 5 °C on every primer-sized sequence. The Cloning menu reports a
// SantaLucia (1998) nearest-neighbour Tm with the Owczarzy (2008) salt
// correction at the lab's own conditions; a status bar quoting a different
// number for the same bases is worse than no number at all. So the display is
// wired to dnaTools.tm instead, and the conditions behind it are one click
// away in the status bar.
//
// Tm is shown only for primer-sized selections. A nearest-neighbour Tm of a
// 3 kb selection is not a quantity anyone should act on, and quoting one
// invites exactly that, so above MAX_TM_BP the line carries GC alone.
(function (root, factory) {
  const req = typeof require === "function" && typeof module !== "undefined";
  const api = factory(req ? require("../cloning/dnaTools") : root.dnaTools);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveSelectionStats = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (dna) {
  // A nearest-neighbour Tm means "the temperature at which half of this
  // oligo is duplexed with its perfect complement". Below ~8 bases the model
  // has little to say; above ~40 it is being asked about something that is
  // not an oligo any more.
  const MIN_TM_BP = 8;
  const MAX_TM_BP = 40;

  // dnaTools is loaded after this file in index.html, so it is looked up
  // when needed rather than captured here.
  const D = () => dna || (typeof window !== "undefined" && window.dnaTools) || null;

  // The same conditions the Cloning menu designs primers at, so the two
  // agree. dnaTools owns the values; these are only for saying them out loud.
  const conditions = () => (D() && D().DEFAULT_CONDITIONS) || {};

  // Shared with the primer hybridisation view so the two cannot drift (#27).
  const N = () => (typeof window !== "undefined" && window.oveTmNote) || null;

  function conditionsText() {
    const n = N();
    if (n) return n.conditionsText(D());
    const c = conditions();
    return [
      `${c.primerNM} nM primer`,
      `${c.Na} mM Na⁺`,
      `${c.Mg} mM Mg²⁺`,
      `${c.dNTPs} mM dNTPs`,
    ].join(", ");
  }

  // The bases a selection layer covers. A selection that crosses the origin
  // of a circular sequence has end < start, and is two slices.
  function selectedSequence(selectionLayer, sequence) {
    if (!sequence || !selectionLayer) return "";
    const { start, end } = selectionLayer;
    if (!(start >= 0) || !(end >= 0)) return "";
    if (end >= start) return sequence.slice(start, end + 1);
    return sequence.slice(start) + sequence.slice(0, end + 1);
  }

  // What can honestly be said about a stretch of bases.
  function stats(seqIn) {
    const seq = String(seqIn || "").replace(/\s/g, "");
    const out = { length: seq.length, gc: null, tm: null, tooLongForTm: false };
    if (!seq.length) return out;
    const d = D();
    out.gc = d ? d.gcPercent(seq) : (100 * (seq.toUpperCase().match(/[GCS]/g) || []).length) / seq.length;
    if (seq.length > MAX_TM_BP) {
      out.tooLongForTm = true;
      return out;
    }
    if (seq.length < MIN_TM_BP || !d) return out;
    const t = d.tm(seq);
    if (Number.isFinite(t)) out.tm = t;
    return out;
  }

  // The tail of the status bar line, e.g. " · Tm 62.2 °C · 55% GC". Also what
  // the selection's hover title carries, because both come out of the same
  // upstream function.
  function format(seq, opts) {
    const o = opts || {};
    const s = stats(seq);
    const bits = [];
    if (o.showTm !== false && Number.isFinite(s.tm)) bits.push(`Tm ${s.tm.toFixed(1)} °C`);
    if (o.showGC !== false && s.gc !== null) {
      const digits = Number.isFinite(o.GCDecimalDigits) ? o.GCDecimalDigits : 0;
      bits.push(`${s.gc.toFixed(digits)}% GC`);
    }
    return bits.length ? ` · ${bits.join(" · ")}` : "";
  }

  // --- the parts that only make sense inside the running app ----------------

  // The View menu's "Melting Temp of Selection" toggle, which upstream keeps
  // in localStorage under this key. Unset means on here; upstream left it off.
  function tmEnabled() {
    try {
      const raw = window.localStorage.getItem("showMeltingTemp");
      return raw === null ? true : JSON.parse(raw);
    } catch (e) {
      return true;
    }
  }

  // Called from getSelectionMessage in the patched bundle. Its three other
  // call sites (the row view's selection title, the circular view's caret and
  // selection titles) pass neither sequenceData nor the GC flag, so the
  // sequence falls back to the active tab's and GC to on — which is what the
  // flag defaults to in this fork anyway.
  function suffix(args) {
    try {
      const a = args || {};
      if (a.isProtein) return "";
      let sequence = a.sequenceData && a.sequenceData.sequence;
      if (!sequence) {
        const doc = window.oveTabs && window.oveTabs.getActive();
        const state = doc && doc.editor && doc.editor.getState();
        sequence = state && state.sequenceData && state.sequenceData.sequence;
      }
      const seq = selectedSequence(a.selectionLayer, sequence);
      if (!seq) return "";
      return format(seq, {
        showGC: a.showGCContent !== false,
        showTm: tmEnabled(),
        GCDecimalDigits: a.GCDecimalDigits,
      });
    } catch (e) {
      return "";
    }
  }

  function showConditions() {
    const ui = window.oveCloningUI;
    if (!ui) return;
    const { h } = ui;
    ui.openDialog({
      title: "Melting temperature",
      width: 520,
      body: h("div", { className: "ove-tmcond" },
        h("p", {}, (N() && N().MODEL) || "Nearest-neighbour Tm, SantaLucia (1998) parameters with the Owczarzy (2008) salt correction for Mg²⁺ and dNTPs."),
        h("p", {}, h("b", {}, "Conditions: "), conditionsText()),
        h("p", {}, `Shown for selections of ${MIN_TM_BP}–${MAX_TM_BP} bp. Longer selections show GC content only: this model describes an oligo annealing to its complement, not a kilobase of duplex.`),
        // what the number means next to the calculator people actually order
        // against (#27)
        ...((N() && N().NEB_PARAGRAPHS) || []).map((t) => h("p", {}, t)),
        h("p", {}, (N() && N().WHERE) || "The Cloning menu designs and reports primers at these same conditions, so the two agree."),
      ),
    });
  }

  // Replaces upstream's Tm status bar item, which would otherwise print a
  // second, different number beside the one in the selection line.
  function statusItem(React, StatusBarItem, seq) {
    if (!tmEnabled()) return null;
    const s = stats(seq);
    if (!Number.isFinite(s.tm)) return null;
    return React.createElement(
      StatusBarItem,
      { dataTest: "veStatusBar-selection-tm" },
      React.createElement(
        "a",
        {
          className: "ove-tmcond-link",
          title: `Tm conditions: ${conditionsText()}`,
          onClick: showConditions,
        },
        "Tm conditions"
      )
    );
  }

  // The View menu's tick should agree with what the status bar is doing, so
  // the default is written down the first time rather than only implied.
  try {
    if (typeof window !== "undefined" && window.localStorage &&
        window.localStorage.getItem("showMeltingTemp") === null) {
      window.localStorage.setItem("showMeltingTemp", "true");
    }
  } catch (e) {
    // private mode, blocked storage: tmEnabled() defaults to on anyway
  }

  return {
    MIN_TM_BP, MAX_TM_BP,
    stats, format, selectedSequence, conditionsText,
    suffix, statusItem, tmEnabled, showConditions,
  };
});
