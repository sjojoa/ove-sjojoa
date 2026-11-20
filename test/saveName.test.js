const assert = require("assert");
const { SAVE_FILTERS, SAVE_EXT, EXTENSIONS } = require("../src/main_utils/sequenceFileFilters.js");

// The name written inside a saved file comes from its file name with the
// extension taken off. Getting this wrong rewrites what the sequence calls
// itself, which is what GenBank readers show.
const nameFor = (filePath) =>
  filePath.slice(filePath.lastIndexOf("/") + 1).replace(SAVE_EXT, "");

describe("the name a saved file gets (audit 6)", () => {
  it("drops the extension", () => {
    assert.strictEqual(nameFor("/plasmids/pUC19.gb"), "pUC19");
    assert.strictEqual(nameFor("/plasmids/reads.fasta"), "reads");
  });

  it("only drops it at the end", () => {
    // this used to come back as "my.notes"
    assert.strictEqual(nameFor("/x/my.fasta.notes.gb"), "my.fasta.notes");
    assert.strictEqual(nameFor("/x/report.txt.gb"), "report.txt");
  });

  it("leaves a dot that is part of the name", () => {
    assert.strictEqual(nameFor("/x/Q1167.dTAG.gb"), "Q1167.dTAG");
  });

  it("does not care about case", () => {
    assert.strictEqual(nameFor("/x/pUC19.GB"), "pUC19");
  });

  it("leaves an unknown extension alone, since it is saved as GenBank anyway", () => {
    assert.strictEqual(nameFor("/x/thing.seq"), "thing.seq");
  });
});

describe("the one list of formats (audit 9)", () => {
  it("offers Genbank first, as the default the dialog uses", () => {
    assert.strictEqual(SAVE_FILTERS[0].extensions[0], "gb");
  });

  it("only offers formats the writer can actually produce", () => {
    // main.js's ove_saveFile branches on these and writes GenBank otherwise
    assert.deepStrictEqual(
      SAVE_FILTERS.map((f) => f.extensions[0]),
      ["gb", "fasta", "json", "bed", "txt"]
    );
  });

  it("can open everything it can save, except bed", () => {
    const cannotOpen = SAVE_FILTERS.map((f) => f.extensions[0]).filter((e) => !EXTENSIONS.includes(e));
    assert.deepStrictEqual(cannotOpen, ["bed"], "bed is write-only: it carries no sequence");
  });
});
