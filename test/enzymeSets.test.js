const assert = require("assert");
const S = require("../src/cloning/enzymeSets.js");

const makeStore = (initial) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
};

describe("reusable enzyme sets", () => {
  it("saves a set and reads it back anywhere", () => {
    const store = makeStore();
    S.save(store, "my panel", ["EcoRI", "BamHI"]);
    assert.deepStrictEqual(S.get(store, "my panel"), ["bamhi", "ecori"]);
    assert.deepStrictEqual(S.names(store), ["my panel"]);
  });

  it("replaces a set saved under a name it already has", () => {
    const store = makeStore();
    S.save(store, "panel", ["EcoRI"]);
    S.save(store, "panel", ["NotI", "NotI", "XhoI"]);
    assert.deepStrictEqual(S.get(store, "panel"), ["noti", "xhoi"]);
    assert.strictEqual(S.names(store).length, 1);
  });

  it("ignores a set with no name", () => {
    const store = makeStore();
    S.save(store, "   ", ["EcoRI"]);
    assert.deepStrictEqual(S.names(store), []);
  });

  it("deletes a set", () => {
    const store = makeStore();
    S.save(store, "a", ["ecori"]);
    S.save(store, "b", ["noti"]);
    S.remove(store, "a");
    assert.deepStrictEqual(S.names(store), ["b"]);
  });

  it("returns nothing for a set that is not there", () => {
    assert.deepStrictEqual(S.get(makeStore(), "missing"), []);
  });

  it("survives a store holding junk rather than losing the app", () => {
    assert.deepStrictEqual(S.readAll(makeStore({ "ove-enzyme-sets": "not json" })), {});
    assert.deepStrictEqual(S.readAll(makeStore({ "ove-enzyme-sets": "[1,2]" })), {});
    assert.deepStrictEqual(S.readAll(null), {});
  });

  it("survives a store that refuses to write", () => {
    const store = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    assert.doesNotThrow(() => S.save(store, "a", ["ecori"]));
  });
});
