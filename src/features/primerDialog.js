// The hybridisation view inside the Add/Edit Primer dialog.
//
// Hooked up through OVE's own `getAdditionalEditAnnotationComps` editor prop,
// so no bundle patch is involved. The dialog already owns the primer's bases
// (its "Bases" field) and its binding coordinates; what it never said is
// whether those bases actually pair where the coordinates claim. Editing the
// bases here only edits the bases: the annotation is moved when — and only
// when — the "Set the binding site from this" button is pressed, because
// recomputing where a primer would bind is not the same as deciding to move
// the primer that is already on the map.
(function () {
  let props = null;
  let host = null;
  let view = null;

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
      docKey: (doc && doc.id) || "default",
      placeholder: "Primer bases, 5′→3′ (a 5′ tail is fine)",
      onChange: (result, bases) => {
        // keep the dialog's own Bases field in step, without touching the
        // coordinates
        if (props && props.change) props.change("bases", bases.toUpperCase());
      },
      buttons: [
        {
          text: "Set the binding site from this",
          icon: "locate",
          title: "Move this primer's start, end and strand onto the site shown",
          onClick: (site) => {
            if (!site) return U.toast("No binding site to move this primer to", "warning");
            if (!props || !props.change) return;
            // the dialog's start/end fields are 1-based, like the ones the
            // user reads in them; the annotation is converted back on save
            props.change("start", site.start + 1);
            props.change("end", site.end + 1);
            props.change("forward", !site.bottomStrand);
            U.toast(`Binding site set to ${site.start + 1}–${site.end + 1}`);
          },
        },
      ],
    });
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

  // React comes in from the patched call site, because the app does not load
  // its own copy of React — the editor bundle has it.
  function render(React, nextProps) {
    if (!isPrimer(nextProps) || !React) return null;
    props = nextProps;
    return React.createElement("div", { className: "ove-ph-dialog-host", ref });
  }

  window.ovePrimerDialog = { render, ref };
})();
