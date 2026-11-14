const assert = require("assert");
const S = require("../src/tabs/scrollMemory.js");

// Just enough of an element: the three numbers capture/restore read, and a
// querySelector for rowViewIn.
const el = (scrollHeight, clientHeight, scrollTop = 0) => ({ scrollHeight, clientHeight, scrollTop });
const container = (found) => ({ querySelector: (sel) => (sel === ".veRowView" ? found : null) });

describe("remembering where a tab was looking (#23)", () => {
  describe("rowViewIn", () => {
    it("finds the row view inside a tab's container", () => {
      const row = el(1000, 500);
      assert.strictEqual(S.rowViewIn(container(row)), row);
    });

    it("is null when the editor is not mounted", () => {
      assert.strictEqual(S.rowViewIn(container(null)), null);
      assert.strictEqual(S.rowViewIn(null), null);
      assert.strictEqual(S.rowViewIn({}), null);
    });
  });

  describe("capture", () => {
    it("reads the position as a fraction of the scrollable range", () => {
      assert.strictEqual(S.capture(el(1000, 500, 250)), 0.5);
    });

    it("is null at the top: there is nothing worth remembering", () => {
      assert.strictEqual(S.capture(el(1000, 500, 0)), null);
    });

    it("is null when the whole sequence fits on screen", () => {
      assert.strictEqual(S.capture(el(400, 400, 0)), null);
      assert.strictEqual(S.capture(el(300, 400, 0)), null);
    });

    it("is null without an element", () => {
      assert.strictEqual(S.capture(null), null);
    });

    it("never reports more than the end", () => {
      assert.strictEqual(S.capture(el(1000, 500, 9999)), 1);
    });
  });

  describe("restore", () => {
    it("puts the view back where it was", () => {
      const e = el(1000, 500);
      assert.strictEqual(S.restore(e, 0.5), true);
      assert.strictEqual(e.scrollTop, 250);
    });

    it("lands on the same stretch of sequence after a resize", () => {
      // same sequence, window made taller: fewer rows of scroll, same place
      const before = el(1000, 500, 250); // half way
      const f = S.capture(before);
      const after = el(900, 600);
      S.restore(after, f);
      // half way through the new range, not the old 250 px
      assert.strictEqual(after.scrollTop, 150);
    });

    it("reports failure while the row view is still rendering", () => {
      assert.strictEqual(S.restore(el(0, 0), 0.5), false);
      assert.strictEqual(S.restore(null, 0.5), false);
    });

    it("does nothing without a position to restore", () => {
      const e = el(1000, 500, 10);
      assert.strictEqual(S.restore(e, null), false);
      assert.strictEqual(S.restore(e, 0), false);
      assert.strictEqual(S.restore(e, undefined), false);
      assert.strictEqual(e.scrollTop, 10);
    });
  });
});
