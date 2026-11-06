// Tools > Simulate PCR: paste a primer instead of picking an annotation.
//
// Upstream builds its two dropdowns straight from sequenceData.primers, so a
// primer that is in an email rather than on the map cannot be used until two
// annotations have been created and left behind. scripts/patch-ove.js renders
// this block above those dropdowns and merges whatever it places into the
// primer list the tool reads, so the editor's own product assembly — which
// already honours a primer's 5' tail through primer.bases — does the rest.
(function () {
  const FIELDS = {
    forward: { field: "forwardPrimer", label: "Forward", id: "ovePastedForward" },
    reverse: { field: "reversePrimer", label: "Reverse", id: "ovePastedReverse" },
  };

  // what has been placed, per direction: { bases, binding, primer, name }
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

  function describeSite(binding) {
    const site = binding.site;
    const where = `${oneBased(site.start)}–${oneBased(site.end)}`;
    const strand = site.bottomStrand ? "bottom strand" : "top strand";
    const bits = [`binds ${where} (${strand})`];
    bits.push(`${binding.annealLength} nt annealing`);
    if (binding.tail) bits.push(`${binding.tail.length} nt 5′ tail`);
    if (binding.mismatches) bits.push(`${binding.mismatches} mismatch${binding.mismatches > 1 ? "es" : ""}`);
    const D = window.dnaTools;
    if (D) bits.push(`Tm ${D.tm(binding.annealSeq).toFixed(1)} °C`);
    return bits.join(" · ");
  }

  function pairNote() {
    const D = window.dnaTools;
    const f = placed.forward && placed.forward.binding;
    const r = placed.reverse && placed.reverse.binding;
    if (!D || !f || !r) return null;
    const temps = D.annealingTemps(D.tm(f.annealSeq), D.tm(r.annealSeq));
    return `Anneal at ${temps.taq} °C (Taq) or ${temps.hifi} °C (Q5/Phusion).`;
  }

  // ---------------------------------------------------------------- slots

  function place(key) {
    const slot = slots[key];
    const spec = FIELDS[key];
    const U = ui();
    const bases = slot.input.value;
    slot.report.innerHTML = "";
    slot.save.style.display = "none";

    if (!bases.trim()) {
      delete placed[key];
      if (props && props.change) props.change(spec.field, undefined);
      return;
    }

    const binding = window.ovePrimerBinding.bindPrimer(template(), bases, {
      isCircular: isCircular(),
    });

    if (!binding.ok) {
      delete placed[key];
      slot.report.appendChild(U.callout(binding.reason, "danger"));
      return;
    }

    if (binding.orientation !== key) {
      // placing it anyway would silently amplify nothing
      delete placed[key];
      slot.report.appendChild(
        U.callout(
          `This primer anneals the other way round — it binds ${oneBased(binding.site.start)}–${oneBased(
            binding.site.end
          )} as a ${binding.orientation} primer. Paste it in the ${
            FIELDS[binding.orientation].label
          } box instead.`,
          "warning"
        )
      );
      return;
    }

    const name = slot.name.value.trim() || `Pasted ${spec.label.toLowerCase()} primer`;
    const primer = window.ovePrimerBinding.virtualPrimer(binding, { id: spec.id, name });
    placed[key] = { bases, binding, primer, name };

    slot.report.appendChild(U.callout(describeSite(binding), binding.mismatches ? "warning" : "success"));
    if (binding.sites.length > 1) {
      // the answer to "why did I get two bands"
      const others = binding.sites
        .slice(1, 6)
        .map((s) => `${oneBased(s.start)}–${oneBased(s.end)}${s.bottomStrand ? " (bottom)" : ""}`)
        .join(", ");
      slot.report.appendChild(
        U.callout(
          `Binds in ${binding.sites.length} places — the product uses the first. Others: ${others}${
            binding.sites.length > 6 ? ", …" : ""
          }`,
          "warning"
        )
      );
    }
    const note = pairNote();
    if (note) slot.report.appendChild(U.callout(note, "primary"));
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
    const input = h("textarea", {
      className: "bp3-input bp3-fill ove-cl-mono",
      rows: 2,
      placeholder: `Paste ${spec.label.toLowerCase()} primer bases, 5′→3′ (a 5′ tail is fine)`,
    });
    const name = textInput("", { placeholder: `Pasted ${spec.label.toLowerCase()} primer`, width: 180 });
    const report = h("div", { className: "ove-pasted-report" });
    const save = button("Save as annotation", () => saveAsAnnotation(key), { icon: "floppy-disk" });
    save.style.display = "none";
    const use = button("Use", () => place(key), { intent: "primary", icon: "locate" });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        place(key);
      }
    });
    slots[key] = { input, name, report, save, use };
    return h(
      "div",
      { className: "ove-pasted-slot" },
      h("div", { className: "ove-pasted-slot-head" }, `${spec.label} primer from bases`),
      input,
      h("div", { className: "ove-cl-row" }, name, use, save),
      report
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

  window.ovePastedPrimers = { render, ref, virtual, place, saveAsAnnotation };
})();
