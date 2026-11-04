// Each open sequence is a tab (src/tabs/tabs.js). This file builds the OVE
// editor for one tab; the tab manager decides when to create and show them.
const ORIGINAL_TITLE = document.title;

function setWindowTitle(name) {
  document.title = ORIGINAL_TITLE + " -- " + (name || "Untitled Sequence");
}

const handleSave =
  (isSaveAs, doc) =>
  async (event, sequenceDataToSave, editorProps, onSuccessCallback) => {
    const filters = [
      { name: "Genbank", extensions: ["gb"] },
      { name: "Fasta", extensions: ["fasta"] },
      { name: "TeselaGen JSON", extensions: ["json"] },
      { name: "Bed", extensions: ["bed"] },
    ];

    let nameToUse;
    let defaultPath = "~/Downloads/";
    if (doc.filePath) {
      nameToUse = doc.filePath.slice(doc.filePath.lastIndexOf("/") + 1);
      defaultPath = doc.filePath.slice(0, doc.filePath.lastIndexOf("/") + 1);
    }
    nameToUse =
      nameToUse || `${sequenceDataToSave.name || "Untitled_Sequence"}.gb`;
    const newFilePath = await window.api.send("ove_showSaveDialog", {
      filters,
      title: nameToUse,
      defaultPath: defaultPath + nameToUse,
      buttonLabel: `Save file ${isSaveAs ? "as" : ""}`,
    });

    if (!newFilePath) {
      return; //cancel the save!
    }

    sequenceDataToSave.name = newFilePath.slice(
      newFilePath.lastIndexOf("/") + 1
    );
    filters.forEach(({ extensions }) => {
      //strip the extension from the name
      sequenceDataToSave.name = sequenceDataToSave.name.replace(
        `.${extensions[0]}`,
        ""
      );
    });

    if (!isSaveAs) {
      doc.filePath = newFilePath;
      window.oveTabs.renameDoc(doc.id, sequenceDataToSave.name);
      doc.editor.updateEditor({
        //update the name of the seq without triggering the undo/redo stack tracking
        sequenceData: sequenceDataToSave,
      });
    }

    window.api.send("ove_saveFile", {
      filePath: newFilePath,
      sequenceDataToSave,
      isSaveAs,
    });
    onSuccessCallback();
    window.toastr.success(`Sequence Saved to ${newFilePath}`);
  };

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
  menuFilter: window.oveCloning.menuFilter,
  isFullscreen: true,
  // or you can pass "createDomNodeForMe" but make sure to use editor.close() to clean up the dom node!

  //you can also pass a DOM node as the first arg here
  // showReadOnly: false,
  // disableSetReadOnly: true,
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
    setNewTitle(newName);
  }, //this option should be shown by default
  // onNew: () => {}, //unless this callback is defined, don't show the option to create a new seq
  // onDuplicate: () => {}, //unless this callback is defined, don't show the option to create a new seq
  onSaveAs: handleSave(true),
  onSave: handleSave(),
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
