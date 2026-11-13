// Which tabs hold unsaved work, and asking before one is thrown away (#8).
//
// Closing a tab or a window used to discard whatever was in it without a word.
// That matters more here than in a text editor: a sequence built by the
// Cloning tools — a PCR product, an assembly, a digest fragment — exists only
// in its tab, with no file on disk to fall back on.
//
// The dirty flag leans on OVE's own bookkeeping. OVE stamps a
// `stateTrackingId` on sequence data whenever it changes, and the save toolbar
// compares it against a `lastSavedId` to decide whether its icon is live. We
// keep the same comparison per tab rather than reading OVE's `lastSavedId`,
// because OVE stamps that from a `.then()` which runs whether or not a file
// was actually written — cancelling a save marks the sequence saved there.
//
// A tab that has never been written anywhere counts as unsaved the moment it
// holds any bases, whether or not it has been edited since it appeared. That
// is the Cloning-tool case, and the one with nothing to recover from.
//
// A tracking id alone is not enough to answer the question, because undo does
// not restore the old id — it stamps a new one. Edit a feature and undo it and
// the sequence is identical to the file again, so being asked to save it is
// wrong. So the id is only used as a cheap "has anything happened at all"
// test; when something has, the content itself is compared against the content
// as it was last read or written. That comparison runs once per edit, not once
// per poll, and the baseline is refreshed from the editor for as long as the
// sequence is still untouched.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveUnsaved = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // What a freshly parsed sequence is stamped with before anything touches it.
  const INITIAL = "initialLoadId";

  // A tab's sequence, whether or not its editor is currently mounted (only the
  // visible tab has one; the others keep a snapshot).
  function sequenceOf(doc) {
    if (!doc) return null;
    if (doc.editor) {
      try {
        return doc.editor.getState().sequenceData;
      } catch (e) {
        /* the editor is being torn down; fall back to the snapshot */
      }
    }
    return doc.seqJson || null;
  }

  // Everything a save would write, in a fixed order, as one string. Two
  // sequences with the same fingerprint produce the same file.
  //
  // Annotation ids are left out on purpose: deleting a feature and adding the
  // same one back gives it a new id but writes an identical file, and that
  // should not count as a change. Case is kept, because changing it is an edit.
  const ANN_TYPES = ["features", "parts", "primers"];
  function fingerprint(sd) {
    if (!sd) return "";
    const parts = [
      sd.sequence || "",
      sd.circular ? "circular" : "linear",
      sd.name || "",
      sd.description || "",
    ];
    ANN_TYPES.forEach((type) => {
      const anns = Object.values(sd[type] || {}).map((a) =>
        [
          a.name || "",
          a.type || "",
          a.start,
          a.end,
          a.forward === false ? "-" : "+",
          a.strand === undefined ? "" : a.strand,
          a.color || "",
          a.bases || "",
          a.notes ? JSON.stringify(a.notes) : "",
        ].join("\u0001")
      );
      // the order OVE keeps them in is not the order they are written in
      anns.sort();
      parts.push(type + ":" + anns.join("\u0002"));
    });
    return parts.join("\u0003");
  }

  function isDirty(doc) {
    const sd = sequenceOf(doc);
    if (!sd) return false;
    // an empty scratch tab has nothing to lose
    if (!(sd.sequence || "").length) return false;
    // never written anywhere: there is no file to recover this from
    if (!doc.filePath) return true;
    const id = sd.stateTrackingId;
    if (!id || id === INITIAL) {
      // still exactly as it was parsed, and this is the state every later edit
      // will be compared against
      doc.savedTrackingId = id || INITIAL;
      doc.savedFingerprint = fingerprint(sd);
      return false;
    }
    // nothing has happened since the last save
    if (id === doc.savedTrackingId) return false;
    // something happened, but it may have been undone again. Compare the
    // content, once per tracking id rather than once per poll.
    if (doc.savedFingerprint === undefined) return true;
    if (doc.checkedTrackingId !== id) {
      doc.checkedTrackingId = id;
      doc.checkedDirty = fingerprint(sd) !== doc.savedFingerprint;
    }
    return doc.checkedDirty;
  }

  // Called after a file is actually written.
  function markSaved(doc) {
    const sd = sequenceOf(doc);
    doc.savedTrackingId = (sd && sd.stateTrackingId) || INITIAL;
    doc.savedFingerprint = fingerprint(sd);
    doc.checkedTrackingId = undefined;
  }

  const dirtyDocs = (docs) => (docs || []).filter(isDirty);

  // A fingerprint of which tabs are dirty, so the tab strip is only rebuilt
  // when the answer changes rather than on every poll.
  const dirtySignature = (docs) =>
    (docs || []).map((d) => (isDirty(d) ? "1" : "0")).join("");

  // Ask about one tab. Returns "save" | "saveAs" | "discard" | "cancel".
  // The dialog itself is the main process's, so the same question is asked
  // whether it came from the × on a tab or from closing the window.
  async function ask(doc) {
    const api = typeof window !== "undefined" && window.api;
    if (!api || !api.send) return "discard";
    const choice = await api.send("ove_confirmClose", {
      name: doc.name,
      hasFile: !!doc.filePath,
    });
    return choice || "cancel";
  }

  // The whole guard for one tab: true means "go ahead and close it".
  // `save` is injected, and the question is asked through `api.ask` rather
  // than the local function, so both can be swapped out when testing without
  // a real save dialog in front of a real message box.
  async function confirmClose(doc, save) {
    if (!isDirty(doc)) return true;
    const choice = await api.ask(doc);
    if (choice === "cancel") return false;
    if (choice === "discard") return true;
    // Save overwrites the file this tab came from; Save As asks where to put
    // it. Either way a cancelled save dialog cancels the close too, which is
    // what every editor does — you asked to save and then did not.
    return !!(await save(doc, { isSaveAs: choice === "saveAs" }));
  }

  const api = {
    INITIAL,
    sequenceOf,
    isDirty,
    markSaved,
    dirtyDocs,
    dirtySignature,
    fingerprint,
    ask,
    confirmClose,
  };
  return api;
});
