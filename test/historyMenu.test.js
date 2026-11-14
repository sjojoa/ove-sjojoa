const assert = require("assert");
const M = require("../src/features/historyMenu.js");

describe("what trimming the history says afterwards (#6)", () => {
  it("says how many went and how many are left", () => {
    assert.deepStrictEqual(M.describe({ ok: true, before: 23, after: 10 }, 10), {
      level: "success",
      message: "Trimmed to 10 saved versions, discarding 13.",
      keep: 10,
    });
  });

  it("gets the singular right", () => {
    assert.strictEqual(
      M.describe({ ok: true, before: 4, after: 1 }, 1).message,
      "Trimmed to 1 saved version, discarding 3."
    );
  });

  it("is explicit when everything went", () => {
    assert.strictEqual(
      M.describe({ ok: true, before: 23, after: 0 }, 0).message,
      "Deleted all 23 saved versions."
    );
  });

  it("says nothing at all when the user cancelled", () => {
    assert.strictEqual(M.describe({ cancelled: true }), null);
    assert.strictEqual(M.describe(null), null);
  });

  it("passes on the reason when there was nothing to do", () => {
    assert.deepStrictEqual(M.describe({ ok: false, reason: "This file has no saved version history." }), {
      level: "warning",
      message: "This file has no saved version history.",
    });
  });

  it("does not claim to have trimmed when the history was already smaller", () => {
    assert.strictEqual(
      M.describe({ ok: true, before: 3, after: 3 }, 10).message,
      "Nothing to trim: the history is already smaller."
    );
  });

  it("offers the same choices everywhere, ending in delete-all", () => {
    const texts = M.CHOICES.filter((c) => c.text).map((c) => c.text);
    assert.deepStrictEqual(texts, [
      "Trim to Last 10 Versions",
      "Trim to Last 5 Versions",
      "Trim to Last Version Only",
      "Delete All History…",
    ]);
    assert.strictEqual(M.CHOICES.find((c) => c.text === "Delete All History…").keep, 0);
  });
});
