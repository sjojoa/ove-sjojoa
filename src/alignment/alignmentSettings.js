// Runs BEFORE open-vector-editor.js: OVE reads its alignment display settings
// from localStorage when it loads, and a stored copy overrides our defaults.
// Turn reference features (and their labels) on once; after that the user's
// own choices in the alignment's eye menu are kept.
(function () {
  const FLAG = "ove-align-features-default-v1";
  try {
    if (localStorage.getItem(FLAG)) return;
    const patch = (key, changes) => {
      const current = JSON.parse(localStorage.getItem(key) || "null");
      if (current) localStorage.setItem(key, JSON.stringify({ ...current, ...changes }));
    };
    ["alignmentAnnotationVisibility", "pairwise_alignmentAnnotationVisibility"].forEach((k) => patch(k, { features: true }));
    ["alignmentAnnotationLabelVisibility", "pairwise_alignmentAnnotationLabelVisibility"].forEach((k) => patch(k, { features: true }));
    localStorage.setItem(FLAG, "1");
  } catch (e) {
    console.warn("could not update alignment display settings", e);
  }
})();
