// Small fixes to the open-vector-editor UMD bundle, applied after `yarn install`.
// Each patch is idempotent and only warns if the target text isn't found
// (e.g. after an OVE upgrade), so installs never fail because of it.
const fs = require("fs");
const path = require("path");

const bundlePath = path.join(
  __dirname,
  "..",
  "node_modules",
  "open-vector-editor",
  "umd",
  "open-vector-editor.js"
);

const patches = [
  {
    name: "pairwise alignment uses the right chromatogram for each read",
    from: "chromatogramData: seqsToAlign[innerIndex].chromatogramData",
    to: "chromatogramData: seqsToAlign[innerIndex > 0 ? topIndex + 1 : 0].chromatogramData",
  },
  {
    name: "alignments show chromatograms and reference features by default",
    from: "  axisNumbers: true,\n  chromatogram: false,\n  dnaColors: false,\n  features: false,",
    to: "  axisNumbers: true,\n  chromatogram: true,\n  dnaColors: false,\n  features: true,",
  },
  {
    // AlignmentView deletes its data when it unmounts, which happens on every
    // tab switch inside the editor, leaving "No Tracks Found" when you come back
    name: "alignments survive switching tabs",
    from: "    removeAlignmentFromRedux({\n      id: id\n    });\n    this.onShortcutCopy",
    to: "    // (alignment kept in redux so it still shows after switching tabs)\n    this.onShortcutCopy",
  },
  {
    name: "previous/next mismatch buttons in the alignment top bar",
    from: 'className: "alignmentViewBackButton"\n    })), ',
    to: 'className: "alignmentViewBackButton"\n    })), window.oveRenderMismatchNav ? window.oveRenderMismatchNav(react_default.a, _this4) : null, ',
  },
  {
    name: "alignment feature labels shown by default",
    from: "  alignmentAnnotationLabelVisibility: {\n    features: false,",
    to: "  alignmentAnnotationLabelVisibility: {\n    features: true,",
  },
  {
    name: "pairwise alignment feature labels shown by default",
    from: "  pairwise_alignmentAnnotationLabelVisibility: {\n    features: false,",
    to: "  pairwise_alignmentAnnotationLabelVisibility: {\n    features: true,",
  },
  {
    // the shared Add/Edit annotation dialog has `change` (redux-form) and
    // `initialValues` in scope here, which is all the colour field needs
    name: "colour picker in the add/edit annotation dialog",
    from: "})), renderTypes || null, renderTags || null,",
    to: "})), renderTypes || null, (window.oveFeatureColorField ? window.oveFeatureColorField(react_default.a, { change: change, initialValues: initialValues, readOnly: _this2.props.readOnly, annotationTypePlural: annotationTypePlural }) : null), renderTags || null,",
  },
  {
    // OVE overwrote the colour with the type's on every save, and indexed
    // getFeatureToColorMap instead of calling it (so it wrote undefined).
    // Keep an explicitly chosen colour; fall back to the type's when unset.
    name: "saving a feature keeps its chosen colour",
    from: "                    updatedData.color = getFeatureToColorMap[updatedData.type];",
    to: "                    if (!updatedData.color) updatedData.color = getFeatureToColorMap()[updatedData.type];",
  },
  {
    name: "alignment tool note reflects the built-in local aligner",
    from: "Note: This tool requires an alignment server to be hooked up for it to work properly. It will NOT work in the OVE demo page.",
    to: "Alignments run locally on this computer (no server needed). Tip: add .ab1 files, tick \\\"Align Sequencing Reads to Reference Sequence\\\" and optionally \\\"Auto-Trim\\\".",
  },
];

if (!fs.existsSync(bundlePath)) {
  console.warn(`[patch-ove] ${bundlePath} not found, skipping`);
  process.exit(0);
}

let source = fs.readFileSync(bundlePath, "utf8");
for (const { name, from, to } of patches) {
  if (source.includes(to)) {
    console.log(`[patch-ove] already applied: ${name}`);
  } else if (source.includes(from)) {
    source = source.split(from).join(to);
    console.log(`[patch-ove] applied: ${name}`);
  } else {
    console.warn(`[patch-ove] target not found, skipped: ${name}`);
  }
}
fs.writeFileSync(bundlePath, source);
