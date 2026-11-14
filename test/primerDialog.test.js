const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// primerDialog.js is a browser script that hangs itself off window; load it
// into a sandbox with just enough of a window to run. Only the pure helpers
// are exercised here -- the view itself needs a DOM and is checked in the app.
function load() {
  const src = fs.readFileSync(path.join(__dirname, "../src/features/primerDialog.js"), "utf8");
  const window = {
    // what startingBases() reaches for when it does fall back to the template
    dnaTools: {
      circSlice: (seq, start, end) => seq.slice(start, end),
    },
    ovePrimerHybridization: {
      reverseComplement: (s) =>
        s
          .split("")
          .reverse()
          .map((c) => ({ A: "T", T: "A", G: "C", C: "G" })[c.toUpperCase()] || c)
          .join(""),
    },
  };
  const sandbox = { window, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return window.ovePrimerDialog;
}

// The dialog's start/end are 1-based, and initialValues is the annotation the
// dialog was opened on.
const dialogProps = (over) =>
  Object.assign(
    {
      sequenceData: { sequence: "ATGGGCAGCAGCCATCATCAT", circular: false },
      bases: "",
      forward: true,
      start: 5,
      end: 5,
      initialValues: { start: 5, end: 5 },
    },
    over
  );

describe("the primer dialog's starting bases (#18)", () => {
  describe("isNewEmptyRange", () => {
    it("is true for a new primer over a single base: that is the bare caret", () => {
      const api = load();
      api._setProps(dialogProps());
      assert.strictEqual(api.isNewEmptyRange(), true);
    });

    it("is false once the range covers more than one base", () => {
      const api = load();
      api._setProps(dialogProps({ end: 12, initialValues: { start: 5, end: 12 } }));
      assert.strictEqual(api.isNewEmptyRange(), false);
    });

    it("is false for an existing primer, however short", () => {
      const api = load();
      api._setProps(dialogProps({ initialValues: { id: "p1", start: 5, end: 5 } }));
      assert.strictEqual(api.isNewEmptyRange(), false);
    });

    it("judges the annotation as created, not as the form now stands", () => {
      const api = load();
      // the form has been edited to a wider range; it was still opened on one base
      api._setProps(dialogProps({ start: 5, end: 20, initialValues: { start: 5, end: 5 } }));
      assert.strictEqual(api.isNewEmptyRange(), true);
    });

    it("falls back to the form values when there are no initialValues", () => {
      const api = load();
      const props = dialogProps({ start: 3, end: 3 });
      delete props.initialValues;
      api._setProps(props);
      assert.strictEqual(api.isNewEmptyRange(), true);
    });
  });

  describe("startingBases", () => {
    it("is empty for a primer created with no selection", () => {
      const api = load();
      api._setProps(dialogProps());
      assert.strictEqual(api.startingBases(), "");
    });

    it("still seeds from the template when a real selection was made", () => {
      const api = load();
      api._setProps(dialogProps({ start: 1, end: 6, initialValues: { start: 1, end: 6 } }));
      assert.strictEqual(api.startingBases(), "ATGGGC");
    });

    it("reverse-complements the template stretch for a bottom-strand primer", () => {
      const api = load();
      api._setProps(
        dialogProps({ start: 1, end: 6, forward: false, initialValues: { start: 1, end: 6 } })
      );
      assert.strictEqual(api.startingBases(), "GCCCAT");
    });

    it("prefers the primer's own bases over anything else", () => {
      const api = load();
      api._setProps(dialogProps({ bases: "acgt" }));
      assert.strictEqual(api.startingBases(), "ACGT");
    });
  });
});
