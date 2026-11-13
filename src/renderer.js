// Each open sequence is a tab (src/tabs/tabs.js). This file builds the OVE
// editor for one tab; the tab manager decides when to create and show them.
const ORIGINAL_TITLE = document.title;

// One stable function, built once: OVE memoizes on the identity of menuFilter
// and warns if it is handed a new one on every render. The Cloning menu is
// added, File > Import Sequence is pointed at our own paste dialog, and
// tagged text joins the Export Sequence submenu.
const MENU_FILTER = (menu) =>
  window.oveMenuLabels.menuFilter(
    window.oveTaggedExport.menuFilter(
      window.oveImport.menuFilter(window.oveCloning.menuFilter(menu))
    )
  );

// Same idea for the right-click menus, which OVE passes through their own hook.
const RIGHT_CLICK_OVERRIDES = Object.assign(
  {},
  window.oveTaggedExport.rightClickOverrides,
  window.oveMenuLabels.rightClickOverrides
);

function setWindowTitle(name) {
  document.title = ORIGINAL_TITLE + " -- " + (name || "Untitled Sequence");
}

// Saving one tab. Returns true if a file was actually written, false if the
// user cancelled, so the unsaved-changes guard (#8) can tell the difference.
//
// Save overwrites the file the tab came from, with no dialog, which is what
// Save means everywhere else. Save As always asks, so it is the way to rename
// a sequence or put it somewhere else. A tab that has never been written
// anywhere has nothing to overwrite, so Save asks too.
//
// Either way the file written becomes the tab's file, so the next plain Save
// goes to the place you last chose. Upstream treated Save As as "export a
// copy and keep editing the old file", which meant renaming a construct
// quietly left you still overwriting its previous name.
//
// `sequenceDataToSave` is what OVE's own save wrapper hands us (tidied, with
// annotations as objects). The guard has no such wrapper to go through, so it
// calls this with nothing and we take the live state instead.
async function saveDoc(doc, { isSaveAs = false, sequenceDataToSave, onSuccessCallback } = {}) {
  if (!doc) return false;
  if (!sequenceDataToSave) {
    const live = doc.editor ? doc.editor.getState().sequenceData : doc.seqJson;
    sequenceDataToSave = JSON.parse(JSON.stringify(live || {}));
  }
  const filters = [
    { name: "Genbank", extensions: ["gb"] },
    { name: "Fasta", extensions: ["fasta"] },
    { name: "TeselaGen JSON", extensions: ["json"] },
    { name: "Bed", extensions: ["bed"] },
    // the lab's inline-tagged format: features written between the bases,
    // which is what gets pasted into notes and protocols
    { name: "Tagged text", extensions: ["txt"] },
  ];

  let newFilePath = doc.filePath;
  if (isSaveAs || !newFilePath) {
    let nameToUse;
    let defaultPath = "~/Downloads/";
    if (doc.filePath) {
      nameToUse = doc.filePath.slice(doc.filePath.lastIndexOf("/") + 1);
      defaultPath = doc.filePath.slice(0, doc.filePath.lastIndexOf("/") + 1);
    }
    nameToUse = nameToUse || `${sequenceDataToSave.name || "Untitled_Sequence"}.gb`;
    newFilePath = await window.api.send("ove_showSaveDialog", {
      filters,
      title: nameToUse,
      defaultPath: defaultPath + nameToUse,
      buttonLabel: `Save file ${isSaveAs ? "as" : ""}`,
    });
    if (!newFilePath) {
      return false; //cancel the save!
    }
  }

  sequenceDataToSave.name = newFilePath.slice(newFilePath.lastIndexOf("/") + 1);
  filters.forEach(({ extensions }) => {
    //strip the extension from the name
    sequenceDataToSave.name = sequenceDataToSave.name.replace(`.${extensions[0]}`, "");
  });

  doc.filePath = newFilePath;
  window.oveTabs.renameDoc(doc.id, sequenceDataToSave.name);
  // a tab that is not the visible one has no live editor to update; its
  // snapshot already holds what we just wrote
  if (doc.editor) {
    doc.editor.updateEditor({
      //update the name of the seq without triggering the undo/redo stack tracking
      sequenceData: sequenceDataToSave,
    });
  }

  window.api.send("ove_saveFile", {
    filePath: newFilePath,
    sequenceDataToSave,
  });
  // This tab is now clean as far as the guard is concerned. OVE keeps its
  // own lastSavedId, but it stamps it from a .then() that runs whether or
  // not a file was written, so cancelling a save marks a sequence saved
  // there; the tab's own record is the one the guard trusts.
  window.oveUnsaved.markSaved(doc);
  if (onSuccessCallback) onSuccessCallback();
  window.toastr.success(`Sequence Saved to ${newFilePath}`);
  return true;
}

window.oveSaveDoc = saveDoc;

// Builds the editor for one tab. `doc` is the tab manager's record for it.
// `restoring` is true when a tab is being shown again after being unmounted:
// its panel layout and undo history are still in the shared store, so we must
// not reset them.
window.oveMakeEditor = function oveMakeEditor(container, doc, restoring) {
  const editor = window.createVectorEditor(container, {
    editorName: doc.editorName,
  autoAnnotateFeatures: window._ove_addons.autoAnnotateFeatures,
  autoAnnotateParts: window._ove_addons.autoAnnotateParts,
  autoAnnotatePrimers: window._ove_addons.autoAnnotatePrimers,
  // runs alignments locally (src/alignment/localAligner.js) instead of the old TeselaGen server
  handleAlignment: window.oveLocalAligner.handleAlignment,
  // adds the "Cloning" menu (src/cloning/cloningTools.js)
  menuFilter: MENU_FILTER,
  rightClickOverrides: RIGHT_CLICK_OVERRIDES,
  isFullscreen: true,
  // or you can pass "createDomNodeForMe" but make sure to use editor.close() to clean up the dom node!

  //you can also pass a DOM node as the first arg here
  // showReadOnly: false,
  // disableSetReadOnly: true,
  // Tm and GC of the selection (src/features/selectionStats.js). GC is a
  // whole number here because a tenth of a percent of a 20-mer is noise.
  showGCContentByDefault: true,
  GCDecimalDigits: 0,
  allowPrimerBasesToBeEdited: true,
  defaultLinkedOligoMessage: '',
  shouldAutosave: false,
  alwaysAllowSave: true,
  // rightClickOverrides: {
  //   selectionLayerRightClicked: (items /* { annotation }, props */) => {
  //     return [
  //       ...items,
  //       {
  //         text: "Create Part",
  //         onClick: () => console.info("hey!≈")
  //       }
  //     ];
  //   }
  // },
  // handleFullscreenClose: () => { //comment this function in to make the editor fullscreen by default
  //   editor.close() //this calls reactDom.unmountComponent at the node you passed as the first arg
  // },
  onRename: (newName) => {
    // upstream called a setNewTitle() that does not exist in this app, so
    // renaming a sequence threw; the tab strip owns the title here
    window.oveTabs.renameDoc(doc.id, newName);
  },
  // onNew: () => {}, //unless this callback is defined, don't show the option to create a new seq
  // onDuplicate: () => {}, //unless this callback is defined, don't show the option to create a new seq
  // upstream passed no `doc`, and the parameter shadowed the one in scope, so
  // every Save and Save As threw "Cannot read properties of undefined
  // (reading 'filePath')" before it reached the dialog
  onSaveAs: (event, sequenceDataToSave, editorProps, onSuccessCallback) =>
    saveDoc(doc, { isSaveAs: true, sequenceDataToSave, onSuccessCallback }),
  onSave: (event, sequenceDataToSave, editorProps, onSuccessCallback) =>
    saveDoc(doc, { sequenceDataToSave, onSuccessCallback }),
  onImport: (sequenceData) => {
    try {
      doc.editor.updateEditor({
        sequenceData,
      });
    } catch (error) {
      console.error(`error 129821:`, error);
    }
  },
  // onDelete: data => {
  //   console.warn("would delete", data);
  // },
  // onCopy: function(event, copiedSequenceData /* , editorState */) {
  //   //the copiedSequenceData is the subset of the sequence that has been copied in the teselagen sequence format
  //   const clipboardData = event.clipboardData;
  //   clipboardData.setData("text/plain", copiedSequenceData.sequence);
  //   clipboardData.setData(
  //     "application/json",
  //     //for example here you could change teselagen parts into jbei parts
  //     JSON.stringify(copiedSequenceData)
  //   );
  //   event.preventDefault();
  //   //in onPaste in your app you can do:
  //   // e.clipboardData.getData('application/json')
  // },
  // onPaste: function(event /* , editorState */) {
  //   //the onPaste here must return sequenceData in the teselagen data format
  //   const clipboardData = event.clipboardData;
  //   let jsonData = clipboardData.getData("application/json");
  //   if (jsonData) {
  //     jsonData = JSON.parse(jsonData);
  //     if (jsonData.isJbeiSeq) {
  //       jsonData = convertJbeiToTeselagen(jsonData);
  //     }
  //   }
  //   const sequenceData = jsonData || {
  //     sequence: clipboardData.getData("text/plain")
  //   };
  //   return sequenceData;
  // },
  // getSequenceAtVersion: versionId => {
  //   if (versionId === 2) {
  //     return {
  //       sequence: "thomaswashere"
  //     };
  //   } else if ((versionId = 3)) {
  //     return {
  //       features: [{ start: 4, end: 6 }],
  //       sequence:
  //         "GGGAAAagagagtgagagagtagagagagaccacaccccccGGGAAAagagagtgagagagtagagagagaccacaccccccGGGAAAagagagtgagagagtagagagagaccacaccccccGGGAAAagagagtgagagagtagagagagaccacacccccc"
  //     };
  //   } else {
  //     console.error("we shouldn't be here...");
  //     return {
  //       sequence: "taa"
  //     };
  //   }
  // },
  // getVersionList: () => {
  //   return [
  //     {
  //       dateChanged: "12/30/2211",
  //       editedBy: "Nara",
  //       // revisionType: "Sequence Deletion",
  //       versionId: 2
  //     },
  //     {
  //       dateChanged: "8/30/2211",
  //       editedBy: "Ralph",
  //       // revisionType: "Feature Edit",
  //       versionId: 3
  //     }
  //   ];
  // },
  showMenuBar: true,
  PropertiesProps: {
    propertiesList: [
      "general",
      "features",
      "parts",
      "primers",
      "translations",
      "cutsites",
      "orfs",
      "genbank",
    ],
  },
  ToolBarProps: {
    toolList: [
      "saveTool",
      "downloadTool",
      "importTool",
      "undoTool",
      "redoTool",
      "cutsiteTool",
      "featureTool",
      "alignmentTool",
      "versionHistoryTool",
      // "oligoTool",
      "orfTool",
      // "viewTool",
      "editTool",
      "findTool",
      "visibilityTool",
      // "propertiesTool"
    ],
  },
  });
  doc.editor = editor;

  const seqDataToUse = doc.seqJson || { circular: true };
  const isCircular = seqDataToUse && seqDataToUse.circular;
  if (restoring) {
    // everything else is already in the store under this editorName
    editor.updateEditor({ sequenceData: seqDataToUse });
    return editor;
  }
  editor.updateEditor({
    sequenceData: seqDataToUse,
  sequenceDataHistory: {}, //clear the sequenceDataHistory if there is any left over from a previous sequence
  annotationVisibility: {
    // features: false,
    orfTranslations: false,
  },
  readOnly: false,
  panelsShown: [
    [
      {
        // fullScreen: true,
        active: !!isCircular,
        id: "circular",
        name: "Circular Map",
      },
      {
        id: "rail",
        name: "Linear Map",
        active: !isCircular,
      },
    ],
    [
      {
        id: "sequence",
        name: "Sequence Map",
        active: true,
      },

      {
        id: "properties",
        name: "Properties",
      },
    ],
  ],
  annotationsToSupport: {
    features: true,
    translations: true,
    parts: true,
    orfs: true,
    cutsites: true,
    primers: true,
  },
});

  return editor;
};

window.oveSetWindowTitle = setWindowTitle;

// Open whatever the main process passed us as the window's first tab.
window.oveTabs.init({
  seqJson: window.initialSeqJson || { circular: true },
  filePath: window.filePath,
});
