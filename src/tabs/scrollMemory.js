// Where each tab was looking in its sequence.
//
// Only the tab in front has a live editor: switching tabs unmounts the one
// you left and builds the one you came to (two OVE editors fight over the
// single shared redux store). The row view's scroll position is plain DOM
// state in that torn-down tree, so coming back put you at base 1 -- fine for
// a short insert, useless for finding your way back to where you were in a
// 10 kb plasmid.
//
// What is remembered is a fraction, not a pixel offset. The row view is a
// stack of equal-height rows, so how far down it you are scrolled is how far
// through the sequence you are, whatever the window width or zoom happen to
// be. Restoring a pixel offset would land somewhere else entirely after a
// resize, or after switching to a tab whose sequence is a different length;
// restoring a fraction lands on the same stretch of DNA.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.oveScrollMemory = api;
})(typeof self !== "undefined" ? self : this, function () {
  // The row view, within one tab's container. Null while the editor is being
  // built or has already gone.
  function rowViewIn(container) {
    if (!container || !container.querySelector) return null;
    return container.querySelector(".veRowView");
  }

  // How far down the row view we are, as 0..1. Null when there is nothing to
  // remember: no element, or nothing to scroll because the whole sequence
  // fits on screen.
  function capture(el) {
    if (!el) return null;
    const range = el.scrollHeight - el.clientHeight;
    if (!(range > 0)) return null;
    const top = el.scrollTop || 0;
    if (top <= 0) return null;
    return Math.min(1, top / range);
  }

  // Put it back. Returns true if it did, so the caller knows whether to stop
  // retrying -- the row view is rendered asynchronously, and for a moment
  // after the editor mounts there is nothing to scroll yet.
  function restore(el, fraction) {
    if (!el || typeof fraction !== "number" || !(fraction > 0)) return false;
    const range = el.scrollHeight - el.clientHeight;
    if (!(range > 0)) return false;
    el.scrollTop = Math.round(fraction * range);
    return true;
  }

  return { rowViewIn, capture, restore };
});
