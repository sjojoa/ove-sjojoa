// File > Export Sequence > Download Tagged Text File.
//
// Save As can already write .txt, but Export Sequence is where the other
// formats live, so that is where people look for this one.
(function () {
  const typeColor = (type) => {
    try {
      return (window.sequenceUtils.getFeatureToColorMap({ includeHidden: true }) || {})[type];
    } catch (e) {
      return undefined;
    }
  };

  // the editor's Copy Options (File > Copy Options), defaulted the way OVE
  // defaults them
  function copyOptions() {
    const doc = window.oveTabs && window.oveTabs.getActive();
    const defaults = { features: true, partialFeatures: false, parts: true, partialParts: false };
    try {
      return Object.assign(defaults, doc.editor.getState().copyOptions);
    } catch (e) {
      return defaults;
    }
  }

  function activeSequence() {
    const doc = window.oveTabs && window.oveTabs.getActive();
    if (!doc || !doc.editor) return null;
    try {
      return doc.editor.getState().sequenceData;
    } catch (e) {
      return null;
    }
  }

  function download() {
    const seqData = activeSequence();
    if (!seqData || !window.oveTaggedText) return;
    const { text, warnings } = window.oveTaggedText.renderTagged(seqData, {
      attrs: "minimal",
      typeColor,
    });
    const name = (seqData.name || "Untitled_Sequence").replace(/[/\\:]/g, "_");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (warnings.length) window.oveTabs.warn("Exported as tagged text", warnings);
    window.oveCloningUI && window.oveCloningUI.toast(`Exported ${name}.txt`);
  }

  // Right-click a selection > Copy as tagged text. Copying the whole file is
  // the rare case; usually what you want pasted into a protocol is the insert,
  // the cassette or the region you just selected, with its features riding
  // along. Annotations are clipped to the selection and renumbered, which the
  // format does for free since its coordinates are implicit.
  function copyAsTagged(range) {
    const seqData = activeSequence();
    if (!seqData || !window.oveTaggedText) return;
    const su = window.sequenceUtils;
    const whole = !range || typeof range.start !== "number" || range.start < 0;
    let part = seqData;
    if (!whole && su && su.getSequenceDataBetweenRange) {
      // follow the editor's own Copy Options, so this behaves like Copy does:
      // by default a feature only half inside the selection is left out
      const opts = copyOptions();
      part = su.getSequenceDataBetweenRange(
        seqData,
        { start: range.start, end: range.end },
        {
          exclude: { features: !opts.features, parts: !opts.parts },
          excludePartial: {
            features: !opts.partialFeatures,
            primers: !opts.partialFeatures,
            parts: !opts.partialParts,
          },
        }
      );
      part = Object.assign({}, part, {
        name: `${seqData.name || "sequence"}_${range.start + 1}-${range.end + 1}`,
      });
    }
    const { text, warnings } = window.oveTaggedText.renderTagged(part, {
      attrs: "minimal",
      typeColor,
    });
    // the header is for files; a clipboard paste wants the bases and nothing else
    const body = text.replace(/^(#[^\n]*\n)+\n?/, "").trim();
    const ui = window.oveCloningUI;
    if (ui) ui.copyText(body, `${whole ? "Sequence" : `${body.replace(/\[[^\]]*\]/g, "").length} bp`} as tagged text`);
    if (warnings.length && window.oveTabs) window.oveTabs.warn("Copied as tagged text", warnings);
  }

  // OVE hands the right-click menu through this hook before showing it.
  // sits with the other copy commands where there are any, otherwise at the end
  function withCopyItem(items, annotation) {
    const entry = {
      text: "Copy as Tagged Text",
      onClick: () => copyAsTagged(annotation),
    };
    const next = [...items];
    const i = next.findIndex(
      (item) => item && typeof item.text === "string" && /^Copy\b/.test(item.text)
    );
    next.splice(i === -1 ? next.length : i + 1, 0, entry);
    return next;
  }

  const copyFrom = (items, opts) => withCopyItem(items, opts && opts.annotation);

  const rightClickOverrides = {
    selectionLayerRightClicked: copyFrom,
    // right-clicking the annotation itself copies just it, without having to
    // select its bases first
    featureRightClicked: copyFrom,
    partRightClicked: copyFrom,
    primerRightClicked: copyFrom,
  };

  // stable reference: OVE memoizes on the identity of menuFilter
  function menuFilter(menu) {
    return menu.map((top) => {
      if (!top || top.text !== "File" || !Array.isArray(top.submenu)) return top;
      return Object.assign({}, top, {
        submenu: top.submenu.map((item) => {
          if (!item || item.text !== "Export Sequence" || !Array.isArray(item.submenu)) return item;
          return Object.assign({}, item, {
            submenu: [
              ...item.submenu,
              { text: "Download Tagged Text File", onClick: download },
            ],
          });
        }),
      });
    });
  }

  window.oveTaggedExport = { download, menuFilter, copyAsTagged, rightClickOverrides };
})();
