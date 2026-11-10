const assert = require("assert");
const { isDirty, markSaved, dirtyDocs, dirtySignature, confirmClose, INITIAL } =
  require("../src/tabs/unsaved");

const tab = (over = {}) =>
  Object.assign(
    {
      id: "doc1",
      name: "pA11990.gb",
      filePath: "/seqs/pA11990.gb",
      seqJson: { sequence: "acgtacgtacgt", stateTrackingId: INITIAL },
      editor: null,
    },
    over
  );

describe("which tabs hold unsaved work (#8)", () => {
  it("calls a freshly opened file clean", () => {
    assert.strictEqual(isDirty(tab()), false);
  });

  it("calls an edited file dirty", () => {
    const t = tab({ seqJson: { sequence: "acgt", stateTrackingId: "abc123" } });
    assert.strictEqual(isDirty(t), true);
  });

  it("is clean again once that exact state has been written", () => {
    const t = tab({ seqJson: { sequence: "acgt", stateTrackingId: "abc123" } });
    markSaved(t);
    assert.strictEqual(isDirty(t), false);
    t.seqJson.stateTrackingId = "def456"; // edited again
    assert.strictEqual(isDirty(t), true);
  });

  it("calls a sequence that was never written anywhere dirty, edited or not", () => {
    // what a Cloning tool produces: bases, no file, nothing touched since
    const t = tab({ filePath: undefined, seqJson: { sequence: "acgt", stateTrackingId: INITIAL } });
    assert.strictEqual(isDirty(t), true);
  });

  it("leaves an empty scratch tab alone", () => {
    const t = tab({ filePath: undefined, seqJson: { sequence: "", stateTrackingId: INITIAL } });
    assert.strictEqual(isDirty(t), false);
  });

  it("reads through a mounted editor rather than the snapshot", () => {
    const t = tab({
      seqJson: { sequence: "acgt", stateTrackingId: INITIAL },
      editor: { getState: () => ({ sequenceData: { sequence: "acgtt", stateTrackingId: "xyz" } }) },
    });
    assert.strictEqual(isDirty(t), true);
  });

  it("falls back to the snapshot if the editor is being torn down", () => {
    const t = tab({
      editor: {
        getState: () => {
          throw new Error("unmounted");
        },
      },
    });
    assert.strictEqual(isDirty(t), false);
  });

  it("summarises a strip so it is only redrawn when the answer changes", () => {
    const clean = tab();
    const dirty = tab({ id: "doc2", seqJson: { sequence: "acgt", stateTrackingId: "z" } });
    assert.deepStrictEqual(dirtyDocs([clean, dirty]), [dirty]);
    assert.strictEqual(dirtySignature([clean, dirty]), "01");
  });
});

describe("the close guard (#8)", () => {
  const saveReturning = (result) => {
    const calls = [];
    return [
      (doc) => {
        calls.push(doc);
        return Promise.resolve(result);
      },
      calls,
    ];
  };
  // confirmClose asks through window.api; stub it per test.
  const withAnswer = (answer, fn) => {
    global.window = { api: { send: async () => answer } };
    return fn().finally(() => {
      delete global.window;
    });
  };

  it("closes a clean tab without asking", async () => {
    const [save, calls] = saveReturning(true);
    assert.strictEqual(await confirmClose(tab(), save), true);
    assert.strictEqual(calls.length, 0);
  });

  const dirtyTab = () => tab({ seqJson: { sequence: "acgt", stateTrackingId: "abc" } });

  it("cancels the close when the user cancels", () =>
    withAnswer("cancel", async () => {
      const [save, calls] = saveReturning(true);
      assert.strictEqual(await confirmClose(dirtyTab(), save), false);
      assert.strictEqual(calls.length, 0);
    }));

  it("closes and discards on Don't Save", () =>
    withAnswer("discard", async () => {
      const [save, calls] = saveReturning(true);
      assert.strictEqual(await confirmClose(dirtyTab(), save), true);
      assert.strictEqual(calls.length, 0);
    }));

  it("saves first on Save, then closes", () =>
    withAnswer("save", async () => {
      const [save, calls] = saveReturning(true);
      assert.strictEqual(await confirmClose(dirtyTab(), save), true);
      assert.strictEqual(calls.length, 1);
    }));

  it("keeps the tab open if the save dialog itself is cancelled", () =>
    withAnswer("save", async () => {
      const [save] = saveReturning(false);
      assert.strictEqual(await confirmClose(dirtyTab(), save), false);
    }));
});
