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

  window.oveTaggedExport = { download, menuFilter };
})();
