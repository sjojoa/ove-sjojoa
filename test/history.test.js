const assert = require("assert");
const bioParsers = require("bio-parsers");
const H = require("../src/main_utils/history.js");

const seq = (over) =>
  Object.assign({ name: "pTest", sequence: "atgcatgcatgcatgcatgcatgc", circular: true }, over);

describe("saved-version history (#6)", () => {
  describe("the comment in the file", () => {
    it("keeps human comments and the history apart", () => {
      const out = H.split(["written by hand", H.MARKER + "aaa.bbb", "and another"]);
      assert.deepStrictEqual(out.comments, ["written by hand", "and another"]);
      assert.deepStrictEqual(out.entries, ["aaa", "bbb"]);
    });

    it("treats a file with no history as having none", () => {
      assert.deepStrictEqual(H.split(["just a comment"]).entries, []);
      assert.deepStrictEqual(H.split(undefined).entries, []);
      assert.deepStrictEqual(H.split([]).entries, []);
    });

    it("writes no marker at all when the history is empty", () => {
      assert.deepStrictEqual(H.join(["hello"], []), ["hello"]);
      assert.deepStrictEqual(H.write(seq({ comments: ["hello"] }), []).comments, ["hello"]);
    });

    it("drops the comments key entirely when nothing is left", () => {
      const out = H.write(seq({ comments: [H.MARKER + "aaa"] }), []);
      assert.ok(!("comments" in out));
    });

    it("replaces an existing history rather than stacking a second one", () => {
      const once = H.write(seq(), ["aaa"]);
      const twice = H.write(once, ["bbb"]);
      assert.deepStrictEqual(twice.comments, [H.MARKER + "bbb"]);
    });

    it("never hands the history to the editor", () => {
      const withHistory = seq({ comments: ["a note", H.MARKER + "aaa"] });
      assert.deepStrictEqual(H.strip(withHistory).comments, ["a note"]);
      // and leaves the original alone
      assert.strictEqual(withHistory.comments.length, 2);
    });
  });

  describe("adding versions", () => {
    it("records what was saved, with who and when", () => {
      const e = H.add([], seq(), { at: "2026-01-01T00:00:00.000Z", by: "sjojoa" });
      const [v] = H.list(e);
      assert.strictEqual(v.savedAt, "2026-01-01T00:00:00.000Z");
      assert.strictEqual(v.dateChanged, H.when("2026-01-01T00:00:00.000Z"));
      assert.strictEqual(v.editedBy, "sjojoa");
      assert.strictEqual(H.dataAt(e, v.versionId).sequence, seq().sequence);
    });

    it("does not record a save that changed nothing", () => {
      const one = H.add([], seq());
      const two = H.add(one, seq());
      assert.strictEqual(two.length, 1);
    });

    it("records a save that did change something", () => {
      const one = H.add([], seq());
      const two = H.add(one, seq({ sequence: "atgcatgcatgcatgcatgcatgg" }));
      assert.strictEqual(two.length, 2);
    });

    it("ignores the history itself when deciding whether anything changed", () => {
      const one = H.add([], seq({ comments: ["note"] }));
      const two = H.add(one, seq({ comments: ["note", H.MARKER + "aaa"] }));
      assert.strictEqual(two.length, 1);
    });

    it("keeps only the most recent versions", () => {
      let e = [];
      for (let i = 0; i < 10; i++) e = H.add(e, seq({ sequence: "atgc".repeat(i + 1) }), { cap: 4 });
      assert.strictEqual(e.length, 4);
      // the four newest, newest first
      const lengths = H.list(e).map((v) => H.dataAt(e, v.versionId).sequence.length);
      assert.deepStrictEqual(lengths, [40, 36, 32, 28]);
    });

    it("lists newest first", () => {
      let e = H.add([], seq({ sequence: "aaaa" }), { at: "2026-01-01T00:00:00.000Z" });
      e = H.add(e, seq({ sequence: "cccc" }), { at: "2026-02-02T00:00:00.000Z" });
      assert.deepStrictEqual(
        H.list(e).map((v) => v.savedAt),
        ["2026-02-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]
      );
    });

    it("returns nothing for a version that is not there", () => {
      assert.strictEqual(H.dataAt(H.add([], seq()), "nope"), null);
      assert.strictEqual(H.dataAt([], "nope"), null);
    });

    it("skips an entry that has been corrupted rather than failing the list", () => {
      const e = H.add([], seq()).concat(["not-valid-base64url-gzip"]);
      assert.strictEqual(H.list(e).length, 1);
    });
  });

  describe("the date the table shows", () => {
    it("is readable rather than an ISO string, down to the second", () => {
      // built in local time so the rendering does not depend on the test's zone
      const d = new Date(2026, 10, 14, 6, 34, 7);
      assert.strictEqual(H.when(d.toISOString()), "14 Nov 2026, 06:34:07");
    });

    it("passes nonsense through rather than printing Invalid Date", () => {
      assert.strictEqual(H.when("not a date"), "not a date");
      assert.strictEqual(H.when(undefined), "");
    });
  });

  describe("trimming", () => {
    let five;
    beforeEach(() => {
      five = [];
      for (let i = 0; i < 5; i++) five = H.add(five, seq({ sequence: "atgc".repeat(i + 1) }), { cap: 0 });
    });

    it("keeps the most recent n", () => {
      assert.strictEqual(H.trim(five, 2).length, 2);
      assert.deepStrictEqual(H.trim(five, 2), five.slice(-2));
    });

    it("clears everything at 0", () => {
      assert.deepStrictEqual(H.trim(five, 0), []);
    });

    it("leaves a shorter history alone", () => {
      assert.strictEqual(H.trim(five, 50).length, 5);
    });

    it("ignores nonsense rather than throwing the history away", () => {
      assert.strictEqual(H.trim(five, "abc").length, 5);
      assert.strictEqual(H.trim(five, -1).length, 5);
    });
  });

  // The reason for base64url: a comment containing "=" does not survive
  // bio-parsers, and "/" at the start of a line ends a GenBank record.
  describe("surviving a real GenBank round trip", () => {
    it("comes back byte-identical, with the human comments intact", async () => {
      let entries = [];
      for (let i = 0; i < 3; i++) {
        entries = H.add(entries, seq({ sequence: "atgcggtcag".repeat(40 + i), comments: ["note"] }));
      }
      const onDisk = H.write(seq({ comments: ["a real comment"] }), entries);
      const genbank = bioParsers.jsonToGenbank(onDisk);
      const back = (await bioParsers.genbankToJson(genbank))[0].parsedSequence;

      const got = H.read(back);
      assert.deepStrictEqual(got, entries, "the history survived unchanged");
      assert.ok(H.split(back.comments).comments.includes("a real comment"));
      assert.strictEqual(H.list(got).length, 3);
      assert.strictEqual(H.dataAt(got, H.list(got)[0].versionId).sequence.length, 420);
    });

    it("writes no padding or slashes that a GenBank reader would choke on", () => {
      const entries = H.add([], seq({ sequence: "atgcggtcag".repeat(100) }));
      assert.ok(!entries[0].includes("="), "no base64 padding");
      assert.ok(!entries[0].includes("/"), "no slashes");
      assert.ok(!entries[0].includes("+"), "no pluses");
    });
  });
});
