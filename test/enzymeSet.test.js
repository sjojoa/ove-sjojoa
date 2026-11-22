const assert = require("assert");
const S = require("../src/cloning/enzymeSet.js");

describe("saving the enzyme set with the sequence", () => {
  it("round-trips the chosen enzymes", () => {
    const out = S.write({ name: "p", comments: [] }, ["EcoRI", "BsaI"]);
    assert.deepStrictEqual(out.comments, ["ove-enzymes: bsai,ecori"]);
    assert.deepStrictEqual(S.read(out), ["bsai", "ecori"]);
  });

  it("reads nothing from a sequence that has never carried a set", () => {
    assert.deepStrictEqual(S.read({ name: "p" }), []);
    assert.deepStrictEqual(S.read({ comments: ["ordinary note"] }), []);
  });

  it("keeps other comments and replaces only its own line", () => {
    const first = S.write({ comments: ["cloned by SJ"] }, ["ecori"]);
    const second = S.write(first, ["noti"]);
    assert.deepStrictEqual(second.comments, ["cloned by SJ", "ove-enzymes: noti"]);
  });

  it("removes the line when nothing is chosen, rather than leaving an empty one", () => {
    const withSet = S.write({ comments: ["cloned by SJ"] }, ["ecori"]);
    assert.deepStrictEqual(S.write(withSet, []).comments, ["cloned by SJ"]);
  });

  it("does not mutate the sequence it was given", () => {
    const original = { comments: ["note"] };
    S.write(original, ["ecori"]);
    assert.deepStrictEqual(original.comments, ["note"]);
  });

  it("saves enzyme names from the map filter but not its special entries", () => {
    const filter = [
      { value: "single", label: "Single cutters", cutsThisManyTimes: 1 },
      { value: "type2s", label: "Type IIS" },
      { value: "ecori", label: "ecori" },
      { value: "myset__userCreatedGroup", label: "my set" },
    ];
    assert.deepStrictEqual(S.fromFilter(filter), ["ecori"]);
    assert.deepStrictEqual(S.toFilter(["ecori"]), [{ value: "ecori", label: "ecori" }]);
  });
});
