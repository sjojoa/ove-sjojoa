// Tools > Simulate PCR: paste a primer instead of picking an annotation.
//
// Upstream builds its two dropdowns straight from sequenceData.primers, so a
// primer that is in an email rather than on the map cannot be used until two
// annotations have been created and left behind. scripts/patch-ove.js renders
// this block above those dropdowns and merges whatever it places into the
// primer list the tool reads, so the editor's own product assembly — which
// already honours a primer's 5' tail through primer.bases — does the rest.
//
// Each slot is a primer hybridisation view (features/primerView.js), so the
// same per-base pairing, site list and parameters are here as in the Analyzer;
// this file only decides which of the sites found is the one the PCR tool gets.
(function () {
  const FIELDS = {
    forward: { field: "forwardPrimer", label: "Forward", id: "ovePastedForward" },
    reverse: { field: "reversePrimer", label: "Reverse", id: "ovePastedReverse" },
  };

  // what has been placed, per direction: { bases, site, primer, name }
  const placed = {};
  let props = null;
  let root = null;
  const slots = {};

  const ui = () => window.oveCloningUI;
  const template = () => (props && props.sequenceData && props.sequenceData.sequence) || "";
  const isCircular = () => !!(props && props.sequenceData && props.sequenceData.circular);
  const oneBased = (n) => n + 1;

  // Primers the PCR tool should see in addition to the sequence's own.
  function virtual() {
    const out = {};
    Object.keys(placed).forEach((key) => {
      const entry = placed[key];
      if (entry && entry.primer) out[entry.primer.id] = entry.primer;
    });
    return out;
  }

  function pairNote() {
    const D = window.dnaTools;
    const f = placed.forward && placed.forward.site;
    const r = placed.reverse && placed.reverse.site;
    if (!D || !f || !r) return null;
    const temps = D.annealingTemps(D.tm(f.annealSeq), D.tm(r.annealSeq));
    return `Anneal at ${temps.taq} °C (Taq) or ${temps.hifi} °C (Q5/Phusion).`;
  }

  // ---------------------------------------------------------------- slots

  // The PCR tool needs one site per direction, so of everything the view found
  // this picks the one the product will actually come off: the site being
  // looked at if it points the right way, otherwise the best one that does.
  function chooseSite(key, view, result) {
    const wantBottom = key === "reverse";
    const active = view.getSite();
    if (active && active.bottomStrand === wantBottom && !active.fivePrimeOnly) return active;
    return result.sites.find((s) => s.bottomStrand === wantBottom && !s.fivePrimeOnly) || null;
  }

  function onChange(key, result, bases) {
    const slot = slots[key];
    const spec = FIELDS[key];
    const U = ui();
    slot.note.innerHTML = "";
    slot.save.style.display = "none";

    const clear = () => {
      delete placed[key];
      if (props && props.change) props.change(spec.field, undefined);
    };

    if (!bases) return clear();
    if (!result.sites.length) return clear(); // the view already says why

    const site = chooseSite(key, slot.view, result);
    if (!site) {
      clear();
      const other = result.sites[0];
      slot.note.appendChild(
        U.callout(
          `This primer anneals the other way round — it binds ${oneBased(other.start)}–${oneBased(
            other.end
          )} as a ${other.bottomStrand ? "reverse" : "forward"} primer. Paste it in the ${
            FIELDS[other.bottomStrand ? "reverse" : "forward"].label
          } box instead, or reverse-complement it.`,
          "warning"
        )
      );
      return;
    }

    const name = slot.name.value.trim() || `Pasted ${spec.label.toLowerCase()} primer`;
    const primer = {
      id: spec.id,
      name,
      start: site.start,
      end: site.end,
      forward: !site.bottomStrand,
      bases: (site.tail + site.annealSeq).toUpperCase(),
      type: "primer_bind",
      ovePasted: true,
    };
    placed[key] = { bases, site, primer, name };
    slot.note.appendChild(
      U.callout(`Using ${oneBased(site.start)}–${oneBased(site.end)} for the PCR product.`, site.mismatchCount ? "warning" : "success")
    );
    const note = pairNote();
    if (note) slot.note.appendChild(U.callout(note, "primary"));
    slot.save.style.display = "";

    if (props && props.change) props.change(spec.field, spec.id);
  }

  // Opt-in: the primer is only written onto the sequence when asked for.
  function saveAsAnnotation(key) {
    const entry = placed[key];
    const U = ui();
    if (!entry) return;
    const doc = window.oveTabs && window.oveTabs.getActive();
    if (!doc || !doc.editor) return;
    // read the name now, not when the primer was placed: it is usually typed
    // after seeing that the primer binds where it should
    const name = (slots[key].name.value || "").trim() || entry.name;
    const seqData = doc.editor.getState().sequenceData;
    const existing = Array.isArray(seqData.primers)
      ? seqData.primers.slice()
      : Object.values(seqData.primers || {});
    existing.push({
      name,
      start: entry.primer.start,
      end: entry.primer.end,
      forward: entry.primer.forward,
      bases: entry.primer.bases,
      type: "primer_bind",
    });
    doc.editor.updateEditor({ sequenceData: Object.assign({}, seqData, { primers: existing }) });
    U.toast(`Saved "${name}" as a primer annotation`);
  }

  function buildSlot(key) {
    const U = ui();
    const { h, button, textInput } = U;
    const spec = FIELDS[key];
    const name = textInput("", { placeholder: `Pasted ${spec.label.toLowerCase()} primer`, width: 180 });
    const note = h("div", { className: "ove-pasted-report" });
    const save = button("Save as annotation", () => saveAsAnnotation(key), { icon: "floppy-disk" });
    save.style.display = "none";
    const doc = window.oveTabs && window.oveTabs.getActive();
    const view = window.ovePrimerView.create({
      template,
      isCircular,
      compact: true,
      docKey: (doc && doc.id) || "default",
      placeholder: `Paste ${spec.label.toLowerCase()} primer bases, 5′→3′ (a 5′ tail is fine)`,
      onChange: (result, bases) => onChange(key, result, bases),
    });
    slots[key] = { view, name, note, save };
    return h(
      "div",
      { className: "ove-pasted-slot" },
      h("div", { className: "ove-pasted-slot-head" }, `${spec.label} primer from bases`),
      view.el,
      h("div", { className: "ove-cl-row" }, name, save),
      note
    );
  }

  function build(el) {
    const U = ui();
    if (!U) return;
    root = el;
    el.innerHTML = "";
    el.appendChild(
      U.h(
        "details",
        { className: "ove-pasted-details", open: false },
        U.h("summary", {}, "Paste a primer sequence"),
        U.h("div", { className: "ove-pasted-body" }, buildSlot("forward"), buildSlot("reverse"))
      )
    );
  }

  // A stable ref, so React does not tear the block down on every render of the
  // tool — an inline ref callback would, taking the half-typed primer with it.
  function ref(el) {
    if (!el || el === root) return;
    build(el);
  }

  // Called from the patched render; returns the element to put in the tool.
  function render(React, nextProps) {
    props = nextProps;
    return React.createElement("div", { className: "ove-pasted-primers", ref });
  }

  window.ovePastedPrimers = { render, ref, virtual, saveAsAnnotation, slots };
})();
