// The hybridisation view inside the Add/Edit Primer dialog.
//
// Hooked up through OVE's own `getAdditionalEditAnnotationComps` editor prop,
// so no bundle patch is involved.
//
// A primer is its bases. Where it sits on the map is a consequence of them,
// not a second thing to keep in step by hand, so the dialog's Bind Start /
// Bind End fields are hidden (cloning.css) and the annotation follows the
// site computed from the bases: edit them and the primer moves to wherever
// those bases now bind. Upstream kept the two independent, which meant
// adding a base left the annotation behind and the dialog then marked most
// of the oligo as mismatched against a stretch of template it was never
// meant to sit on.
//
// Where the bases bind nowhere, the annotation is left where it was and the
// panel says so: no coordinates would be honest, and silently dropping the
// primer off the map would be worse.
(function () {
  let props = null;
  let host = null;
  let view = null;
  let syncTimer = null;
  let lastRange = "";

  const seqData = () => (props && props.sequenceData) || {};
  const template = () => seqData().sequence || "";
  const isCircular = () => !!seqData().circular;

  const isPrimer = (p) =>
    p &&
    (p.annotationTypePlural === "primers" ||
      (p.initialValues && p.initialValues.type === "primer_bind"));

  // What the dialog starts from: the primer's own bases if it has any, else
  // the stretch of template it is sitting on, which is what its bases would be.
  function startingBases() {
    const bases = (props.bases || "").replace(/[^A-Za-z]/g, "");
    if (bases) return bases.toUpperCase();
    const seq = template();
    const { forward } = props;
    // the dialog's start/end are 1-based
    const start = props.start - 1;
    const end = props.end - 1;
    if (!seq || !(start >= 0) || !(end >= 0)) return "";
    const D = window.dnaTools;
    const stretch = D
      ? D.circSlice(seq, start, end >= start ? end + 1 : end + 1 + seq.length, isCircular())
      : seq.slice(start, end + 1);
    return (forward === false ? window.ovePrimerHybridization.reverseComplement(stretch) : stretch).toUpperCase();
  }

  // Write the chosen site onto the annotation. The form's start/end are
  // 1-based (they were the fields the user used to read), the stored
  // annotation is 0-based, and redux-form is only touched when something
  // actually differs — otherwise every render would dispatch a change and
  // the form would re-render itself in a loop.
  function applySite(site) {
    if (!site || !props || !props.change) return;
    const start = site.start + 1;
    const end = site.end + 1;
    const forward = !site.bottomStrand;
    if (Number(props.start) !== start) props.change("start", start);
    if (Number(props.end) !== end) props.change("end", end);
    if ((props.forward !== false) !== forward) props.change("forward", forward);
  }

  function build(el) {
    const U = window.oveCloningUI;
    if (!U || !window.ovePrimerView) return;
    host = el;
    el.innerHTML = "";
    const doc = window.oveTabs && window.oveTabs.getActive();
    view = window.ovePrimerView.create({
      bases: startingBases(),
      template,
      isCircular,
      compact: true,
      // the dialog already has a Bases field; a second box showing the same
      // sequence is one box too many, and the one that went stale
      showInput: false,
      docKey: (doc && doc.id) || "default",
      placeholder: "Primer bases, 5′→3′ (a 5′ tail is fine)",
      // when nothing binds there are no coordinates to write, so say where
      // the annotation has been left instead of moving it somewhere invented
      noSiteNote: () => {
        const start = Number(props && props.start);
        const end = Number(props && props.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        return `The annotation stays at ${start}–${end}. Nothing here moves it, because these bases do not bind this sequence.`;
      },
      // the site is the annotation: pick a different one in the list and the
      // primer moves to it
      onSite: applySite,
      onChange: (result, bases) => {
        // keep the dialog's own Bases field in step, without touching the
        // coordinates
        const next = bases.toUpperCase();
        if (props && props.change && (props.bases || "").toUpperCase() !== next) {
          props.change("bases", next);
        }
      },
    });
    // Always open: with the coordinate fields gone this is where the primer's
    // position is shown, so it is not something to go looking for. It still
    // collapses while the dialog is up, for anyone who wants the room.
    el.appendChild(
      U.h(
        "details",
        { className: "ove-pasted-details ove-ph-dialog", open: true },
        U.h("summary", {}, "Where this primer binds"),
        view.el
      )
    );
  }

  // A stable ref: React re-renders this dialog on every keystroke in any of
  // its fields, and an inline ref would rebuild the view (and lose the caret)
  // each time.
  function ref(el) {
    if (!el || el === host) return;
    build(el);
  }

  // The dialog's Bases field is the one place bases are typed, so the view
  // follows it. Deferred out of the React render pass, because recomputing
  // calls back into the form.
  function sync() {
    if (!view || !props) return;
    const next = (props.bases || "").replace(/[^A-Za-z]/g, "").toUpperCase();
    if (next && next !== view.getBases()) {
      view.setBases(next);
      lastRange = "";
      return;
    }
    // the coordinates moved but the bases did not: nothing to re-scan, only
    // the "these bases bind elsewhere" note to re-draw
    const range = `${props.start}:${props.end}:${props.forward}`;
    if (range !== lastRange) {
      lastRange = range;
      view.redraw();
    }
  }

  // React comes in from the patched call site, because the app does not load
  // its own copy of React — the editor bundle has it.
  function render(React, nextProps) {
    if (!isPrimer(nextProps) || !React) return null;
    props = nextProps;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(sync, 60);
    return React.createElement("div", { className: "ove-ph-dialog-host", ref });
  }

  window.ovePrimerDialog = { render, ref };
})();
