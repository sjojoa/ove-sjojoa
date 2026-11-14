// Trimming and clearing the saved-version history (#6).
//
// The history is kept inside the sequence file, so it is the plasmid file
// that grows -- about 4 KB per saved version for a 7 kb construct. These are
// the ways to take that back. Which file is involved is always the tab in
// front, which only the renderer knows, so the main process asks rather than
// decides: File > Version History sends "ove_menuHistory" here, and this
// answers with the active tab's path.
//
// The confirmation and the rewriting both happen in main, because that is
// where the file is.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.oveHistory = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Pulled out so the message can be checked without a running app.
  function describe(result, keep) {
    if (!result || result.cancelled) return null;
    if (!result.ok) return { level: "warning", message: result.reason || "Nothing to do." };
    const { before, after } = result;
    const dropped = before - after;
    if (!dropped) return { level: "info", message: "Nothing to trim: the history is already smaller." };
    if (!after) return { level: "success", message: `Deleted all ${before} saved versions.` };
    return {
      level: "success",
      message: `Trimmed to ${after} saved version${after === 1 ? "" : "s"}, discarding ${dropped}.`,
      keep,
    };
  }

  async function trim(keep) {
    const doc = window.oveTabs && window.oveTabs.getActive();
    const result = await window.api.send("ove_historyTrim", {
      filePath: doc && doc.filePath,
      keep,
    });
    const said = describe(result, keep);
    if (said && window.toastr) {
      (window.toastr[said.level] || window.toastr.info)(said.message);
    }
    return result;
  }

  // The items that appear both in the system File menu and in the editor
  // window's own one, so the two cannot drift apart.
  const CHOICES = [
    { text: "Trim to Last 10 Versions", keep: 10 },
    { text: "Trim to Last 5 Versions", keep: 5 },
    { text: "Trim to Last Version Only", keep: 1 },
    { divider: "" },
    { text: "Delete All History…", keep: 0 },
  ];

  function submenu() {
    return CHOICES.map((c) =>
      c.divider !== undefined ? { divider: "" } : { text: c.text, onClick: () => trim(c.keep) }
    );
  }

  if (typeof window !== "undefined" && window.api && window.api.on) {
    window.api.on("ove_menuHistory", ({ keep } = {}) => trim(keep));
  }

  return { trim, describe, submenu, CHOICES };
});
