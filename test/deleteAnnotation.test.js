const assert = require("assert");
const { decide, handle } = require("../src/features/deleteAnnotation");

const FEATURE = {
  id: "f1",
  name: "T7 prom",
  annotationTypePlural: "features",
  start: 0,
  end: 18,
};

// The props withEditorInteractions hands the key binding, reduced to the parts
// the rule reads.
function props(overrides = {}, ann = FEATURE) {
  const calls = [];
  const base = {
    selectedAnnotations: ann
      ? { idStack: [ann.id], idMap: { [ann.id]: ann } }
      : { idStack: [], idMap: {} },
    selectionLayer: ann ? { start: ann.start, end: ann.end } : { start: -1, end: -1 },
    deleteFeature: (a) => calls.push(["deleteFeature", a]),
    deletePart: (a) => calls.push(["deletePart", a]),
    deletePrimer: (a) => calls.push(["deletePrimer", a]),
    annotationDeselectAll: () => calls.push(["annotationDeselectAll"]),
  };
  return [Object.assign(base, overrides), calls];
}

describe("backspace on a selected annotation (#9)", () => {
  it("deletes the one annotation the selection still matches", () => {
    const [p, calls] = props();
    assert.deepStrictEqual(decide(p), { action: "deleteFeature", annotation: FEATURE });
    assert.strictEqual(handle(p, null), true);
    assert.deepStrictEqual(calls[0], ["deleteFeature", FEATURE]);
    assert.deepStrictEqual(calls[1], ["annotationDeselectAll"]);
  });

  it("leaves the keystroke alone when the selection has moved off the annotation", () => {
    // click the feature, then shift+ArrowRight: 1-18 is no longer 0-18
    const [p, calls] = props({ selectionLayer: { start: 1, end: 18 } });
    assert.strictEqual(decide(p), null);
    assert.strictEqual(handle(p, null), false);
    assert.strictEqual(calls.length, 0);
  });

  it("leaves the keystroke alone for a hand-dragged selection", () => {
    const [p] = props({ selectionLayer: { start: 40, end: 60 } }, null);
    assert.strictEqual(decide(p), null);
  });

  it("leaves the keystroke alone when several annotations are selected", () => {
    const other = { ...FEATURE, id: "f2", name: "lacO reg", start: 20, end: 45 };
    const [p] = props({
      selectedAnnotations: {
        idStack: [FEATURE.id, other.id],
        idMap: { [FEATURE.id]: FEATURE, [other.id]: other },
      },
      selectionLayer: { start: 0, end: 45 },
    });
    assert.strictEqual(decide(p), null);
  });

  it("routes parts and primers to their own actions", () => {
    for (const [plural, action] of [["parts", "deletePart"], ["primers", "deletePrimer"]]) {
      const ann = { ...FEATURE, annotationTypePlural: plural };
      const [p] = props({}, ann);
      assert.strictEqual(decide(p).action, action, plural);
    }
  });

  it("refuses derived annotation types", () => {
    for (const plural of ["orfs", "cutsites", "translations"]) {
      const ann = { ...FEATURE, annotationTypePlural: plural };
      const [p] = props({}, ann);
      assert.strictEqual(decide(p), null, plural);
    }
  });

  it("does nothing on a read-only sequence, leaving upstream to say so", () => {
    const [p] = props({ readOnly: true });
    assert.strictEqual(decide(p), null);
  });

  it("does nothing when the editor has no delete action for the type", () => {
    const [p] = props({ deleteFeature: undefined });
    assert.strictEqual(decide(p), null);
  });

  it("consumes the event only when it acts", () => {
    let prevented = 0;
    const event = { preventDefault: () => prevented++, stopPropagation: () => {} };
    const [p] = props();
    handle(p, event);
    assert.strictEqual(prevented, 1);

    const [q] = props({ selectionLayer: { start: 1, end: 18 } });
    handle(q, event);
    assert.strictEqual(prevented, 1, "a sequence delete must reach upstream's handler");
  });
});
