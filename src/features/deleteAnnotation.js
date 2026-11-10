// Backspace / Delete on a clicked annotation deletes the annotation (#9).
//
// Upstream bound both keys straight to `handleDnaDelete`, which looks only at
// the caret and the selection layer. Clicking a feature sets the selection to
// that feature's range, so the obvious gesture — click it, press Backspace —
// silently cut those bases out of the construct instead of removing the
// annotation. Destructive, and easy to do by accident.
//
// The ambiguity is real: after the click the selection genuinely *is* the
// annotation's bases, so one key has two plausible meanings. The rule that
// resolves it is "selected by clicking, and nothing moved since":
//
//   * exactly one annotation is selected (several → leave it alone), and
//   * the selection layer still matches that annotation's range exactly.
//
// Drag out a selection by hand and Backspace still deletes bases, because
// dragging selects no annotation. Nudge the selection after clicking and the
// ranges stop matching, so bases are deleted again — the key never does the
// surprising thing silently.
//
// The deletion goes through OVE's own delete<Type> action, the same one the
// right-click Delete Feature item and the Properties tab's bin button use, so
// it lands in the sequence undo stack and one Cmd+Z puts the annotation back.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveDeleteAnnotation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // ORFs and cut sites are derived, not stored, and a translation is a view of
  // a CDS rather than a thing of its own. Only these three are annotations the
  // user owns and can delete.
  const DELETABLE = {
    features: "deleteFeature",
    parts: "deletePart",
    primers: "deletePrimer",
  };

  // What the user clicked, if they clicked exactly one thing.
  function onlySelected(props) {
    const sel = props && props.selectedAnnotations;
    if (!sel || !sel.idStack || sel.idStack.length !== 1) return null;
    return (sel.idMap && sel.idMap[sel.idStack[0]]) || null;
  }

  // "Nothing has moved since the click": the selection layer is still the
  // annotation's own range. A mismatch means the user went on to select bases.
  function selectionMatches(props, ann) {
    const layer = props.selectionLayer;
    if (!layer || !(layer.start >= 0)) return false;
    return layer.start === ann.start && layer.end === ann.end;
  }

  // The whole decision, with no side effects, so it can be tested directly:
  // the name of the action to call and the annotation to pass it, or null to
  // mean "this keystroke is not an annotation delete".
  function decide(props) {
    if (!props || props.readOnly) return null;
    const annotation = onlySelected(props);
    if (!annotation || !annotation.id) return null;
    const action = DELETABLE[annotation.annotationTypePlural];
    if (!action || typeof props[action] !== "function") return null;
    if (!selectionMatches(props, annotation)) return null;
    return { action, annotation };
  }

  function handle(props, event) {
    const plan = decide(props);
    if (!plan) return false;
    const { action, annotation } = plan;

    if (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
    }
    props[action](annotation);
    // nothing should still claim to have a deleted annotation selected; the
    // bases stay selected, which is where the user was looking
    if (typeof props.annotationDeselectAll === "function") {
      props.annotationDeselectAll(undefined);
    }
    if (typeof window !== "undefined" && window.toastr) {
      const kind = annotation.annotationTypePlural.replace(/s$/, "");
      const name = annotation.name ? ` "${annotation.name}"` : "";
      window.toastr.success(`Deleted ${kind}${name} (Cmd+Z to undo)`);
    }
    return true;
  }

  return { DELETABLE, decide, handle };
});
