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
    // Same dialog, same scope: `this.props` carries the primer's bases, its
    // coordinates and redux-form's `change`, which is everything the
    // hybridisation view needs. OVE's own getAdditionalEditAnnotationComps
    // prop is left alone for other uses.
    name: "hybridisation view in the add/edit primer dialog",
    from: "getAdditionalEditAnnotationComps && getAdditionalEditAnnotationComps(this.props),",
    to: "getAdditionalEditAnnotationComps && getAdditionalEditAnnotationComps(this.props), (window.ovePrimerDialog ? window.ovePrimerDialog.render(react_default.a, this.props) : null),",
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
    // Upstream gave every CDS feature its own translation, stopping dead at
    // that feature's end. src/features/cdsReadThrough.js instead returns one
    // translation per reading frame — tag, linker and gene share a row — and
    // carries it through to the next in-frame stop codon.
    name: "one CDS translation per reading frame, read through to the stop codon",
    from: "Object(lodash[\"reduce\"])(cdsFeatures, function (acc, cdsFeature) {\n    acc[cdsFeature.id] = translationsSelector_extends({}, cdsFeature, {\n      translationType: \"CDS Feature\"\n    });\n    return acc;\n  }, {})",
    to: "(window.oveCdsTranslations ? window.oveCdsTranslations(cdsFeatures, sequence, isCircular) : Object(lodash[\"reduce\"])(cdsFeatures, function (acc, cdsFeature) {\n    acc[cdsFeature.id] = translationsSelector_extends({}, cdsFeature, {\n      translationType: \"CDS Feature\"\n    });\n    return acc;\n  }, {}))",
  },
  {
    // ...and the residues that came from the read-through are drawn in a muted
    // colour, since they are inferred rather than annotated.
    name: "read-through residues are visually muted",
    from: "      } else {\n        color = aminoAcid.color;\n      }\n      return /*#__PURE__*/react_default.a.createElement(Translations_AASliver, {",
    to: "      } else {\n        color = aminoAcid.color;\n      }\n      var oveRt = window.oveReadThroughColor && window.oveReadThroughColor(annotation, aminoAcidSliver.sequenceIndex);\n      if (oveRt) color = oveRt;\n      return /*#__PURE__*/react_default.a.createElement(Translations_AASliver, {",
  },
  {
    // Mismatch-tolerant search (src/features/mismatchSearch.js). When
    // "mismatches allowed" is 0 the editor's own exact search runs unchanged.
    name: "find tool can tolerate mismatches",
    from: "function searchLayersSelector(sequence, isCircular, isOpen, searchString, ambiguousOrLiteral, dnaOrAA, isProtein, proteinSequence) {\n  if (!searchString || !isOpen) {\n    return [];\n  }",
    to: "function searchLayersSelector(sequence, isCircular, isOpen, searchString, ambiguousOrLiteral, dnaOrAA, isProtein, proteinSequence, oveMismatches) {\n  if (!searchString || !isOpen) {\n    return [];\n  }\n  if (oveMismatches > 0 && !isProtein && dnaOrAA === \"DNA\" && window.oveMismatchFind) {\n    return window.oveMismatchFind.searchLayers(sequence, searchString, {\n      isCircular: isCircular,\n      mismatches: oveMismatches,\n      ambiguous: ambiguousOrLiteral === \"AMBIGUOUS\",\n      searchReverseStrand: true\n    });\n  }",
  },
  {
    // ...and the allowance has to be an input to the memoised selector, or
    // changing it would not recompute the hits.
    name: "mismatch allowance feeds the search selector",
    from: "}, function (state) {\n  return state.sequenceData.proteinSequence;\n}, searchLayersSelector));",
    to: "}, function (state) {\n  return state.sequenceData.proteinSequence;\n}, function (state) {\n  return state.findTool && state.findTool.oveMismatches;\n}, searchLayersSelector));",
  },
  {
    // The marks drawn over mismatched bases are search layers too, so that
    // they paint in the sequence map, but they are not matches: without this
    // the find bar would count them and "next match" would stop on them.
    name: "mismatch marks are not counted as matches",
    from: "  var matchesTotal = searchLayers.length;",
    to: "  var matchesTotal = searchLayers.filter(function (l) {\n    return !l.oveMismatchMark;\n  }).length;",
  },
  {
    // With "Highlight All" off the editor keeps only the active match, which
    // would drop that match's own mismatch marks. Keep the marks that fall
    // inside it — they are the point of the search.
    name: "the active match keeps its mismatch marks",
    from: "  if (!findTool.highlightAll && searchLayers[findTool.matchNumber] || searchLayers.length > MAX_MATCHES_DISPLAYED) {\n    searchLayers = [searchLayers[findTool.matchNumber]];\n  }",
    to: "  if (!findTool.highlightAll && searchLayers[findTool.matchNumber] || searchLayers.length > MAX_MATCHES_DISPLAYED) {\n    var oveActive = searchLayers[findTool.matchNumber];\n    var oveInside = function (l) {\n      if (!oveActive || !l || !l.oveMismatchMark) return false;\n      return oveActive.start <= oveActive.end ? l.start >= oveActive.start && l.start <= oveActive.end : l.start >= oveActive.start || l.start <= oveActive.end;\n    };\n    searchLayers = [oveActive].concat(searchLayers.filter(oveInside));\n  }",
  },
  {
    name: "find bar offers a mismatch allowance",
    from: "var findOptionsEls = [/*#__PURE__*/react_default.a.createElement(htmlSelect_HTMLSelect, {\n      key: \"dnaoraa\",",
    to: "var findOptionsEls = [window.oveMismatchFind && window.oveMismatchFind.control(react_default.a), /*#__PURE__*/react_default.a.createElement(htmlSelect_HTMLSelect, {\n      key: \"dnaoraa\",",
  },
  {
    // ...and the active hit's mismatches are spelled out next to the match
    // counter ("3/96  2 mismatches: 412 A>G, 418 T>C"), in both the inline and
    // the expanded find bar.
    name: "find bar names the active match's mismatches",
    from: "}, matchesTotal > 0 ? matchNumber + 1 : 0, \"/\", matchesTotal), /*#__PURE__*/react_default.a.createElement(buttons_Button, {\n      \"data-test\": \"veFindPreviousMatchButton\",",
    to: "}, matchesTotal > 0 ? matchNumber + 1 : 0, \"/\", matchesTotal), window.oveMismatchFind && window.oveMismatchFind.activeDetail(react_default.a), /*#__PURE__*/react_default.a.createElement(buttons_Button, {\n      \"data-test\": \"veFindPreviousMatchButton\",",
  },
  {
    // Simulate PCR could only use primers that were already annotations.
    // src/features/pastedPrimers.js adds a paste box and hands the tool a
    // primer placed on the template; `bases` carries any 5' tail, which the
    // tool's own product assembly already knows how to splice in.
    name: "simulate PCR accepts pasted primers",
    from: "  var fPrimer = sequenceData.primers[forwardPrimer];",
    to: "  var ovePasted = window.ovePastedPrimers && window.ovePastedPrimers.virtual();\n  if (ovePasted && Object.keys(ovePasted).length) {\n    sequenceData = PCRTool_extends({}, sequenceData, {\n      primers: PCRTool_extends({}, sequenceData.primers, ovePasted)\n    });\n  }\n  var fPrimer = sequenceData.primers[forwardPrimer];",
  },
  {
    name: "simulate PCR shows the paste box",
    from: "  }, /*#__PURE__*/react_default.a.createElement(ReactSelectField, {\n    noResultsText: \"Create a new primer in the forward direction to use it in this tool\",",
    to: "  }, window.ovePastedPrimers ? window.ovePastedPrimers.render(react_default.a, props) : null, /*#__PURE__*/react_default.a.createElement(ReactSelectField, {\n    noResultsText: \"No forward primer annotations on this sequence \\u2014 paste bases above instead\",",
  },
  {
    name: "simulate PCR reverse primer empty state mentions pasting",
    from: "    noResultsText: \"Create a new primer in the reverse direction to use it in this tool\",",
    to: "    noResultsText: \"No reverse primer annotations on this sequence \\u2014 paste bases above instead\",",
  },
  {
    // GC was already computed here behind the showGCContent flag; Tm was a
    // separate status bar item quoting a different model. One suffix now
    // carries both, so the status bar line and the selection's hover title
    // agree with each other and with the Cloning menu.
    name: "Tm and GC in the selection message",
    from: '(showGCContent && !isProtein ? " (" + GCContent(GCDecimalDigits) + "% GC)" : "")',
    to: '(window.oveSelectionStats ? window.oveSelectionStats.suffix({ selectionLayer: _selectionLayer, sequenceData: sequenceData, showGCContent: showGCContent, GCDecimalDigits: GCDecimalDigits, isProtein: isProtein }) : (showGCContent && !isProtein ? " (" + GCContent(GCDecimalDigits) + "% GC)" : ""))',
  },
  {
    // upstream's Tm item would print a second, different number next to the
    // one in the selection line; ours states the conditions instead
    name: "status bar Tm item states the conditions",
    from: "showMeltingTemp && /*#__PURE__*/react_default.a.createElement(MeltingTemp, {\n    WrapperToUse: StatusBarItem,\n    sequence: sequence\n  })",
    to: "showMeltingTemp && (window.oveSelectionStats ? window.oveSelectionStats.statusItem(react_default.a, StatusBarItem, sequence) : /*#__PURE__*/react_default.a.createElement(MeltingTemp, {\n    WrapperToUse: StatusBarItem,\n    sequence: sequence\n  }))",
  },
  {
    // 400px cannot hold an alignment of a primer against its template, and
    // the add/edit dialogs then run the full height of the window
    name: "wider add/edit annotation dialogs",
    from: "    isDraggable: true,\n    width: 400\n  }",
    to: "    isDraggable: true,\n    width: 580\n  }",
  },
  {
    // the primer dialog printed upstream's Tm right above the hybridisation
    // view's own, ~6 C apart on the same bases
    name: "one melting temperature in the add/edit primer dialog",
    from: "  })), /*#__PURE__*/react_default.a.createElement(MeltingTemp, {\n    InnerWrapper: AddOrEditPrimerDialog_InnerWrapperMeltingTemp,\n    sequence: bases\n  })));",
    to: "  })), null /* ove: upstream Tm removed; the hybridisation view reports it */));",
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
