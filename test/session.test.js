const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const session = require("../src/main_utils/session");

const { sanitise } = session;
const all = () => true;
const none = () => false;

describe("the session store (#7)", () => {
  describe("reading a stored session", () => {
    it("keeps windows, their path order, and which tab was active", () => {
      const out = sanitise(
        { windows: [{ paths: ["/seqs/vector.gb", "/seqs/insert.gb"], activePath: "/seqs/insert.gb" }] },
        all
      );
      assert.deepStrictEqual(out, [
        { paths: ["/seqs/vector.gb", "/seqs/insert.gb"], activePath: "/seqs/insert.gb" },
      ]);
    });

    it("drops files that no longer exist, quietly", () => {
      const gone = (p) => p !== "/seqs/moved.gb";
      const out = sanitise({ windows: [{ paths: ["/seqs/vector.gb", "/seqs/moved.gb"] }] }, gone);
      assert.deepStrictEqual(out[0].paths, ["/seqs/vector.gb"]);
    });

    it("drops a window whose files have all gone", () => {
      assert.deepStrictEqual(sanitise({ windows: [{ paths: ["/seqs/gone.gb"] }] }, none), []);
    });

    it("falls back to the first tab when the active one is gone", () => {
      const gone = (p) => p !== "/seqs/b.gb";
      const out = sanitise(
        { windows: [{ paths: ["/seqs/a.gb", "/seqs/b.gb"], activePath: "/seqs/b.gb" }] },
        gone
      );
      assert.strictEqual(out[0].activePath, "/seqs/a.gb");
    });

    it("de-duplicates the same file listed twice", () => {
      const out = sanitise({ windows: [{ paths: ["/seqs/a.gb", "/seqs/a.gb"] }] }, all);
      assert.deepStrictEqual(out[0].paths, ["/seqs/a.gb"]);
    });

    it("survives anything at all in the file", () => {
      for (const raw of [null, undefined, 42, "nope", {}, { windows: "no" }, { windows: [null, 7] }]) {
        assert.deepStrictEqual(sanitise(raw, all), [], JSON.stringify(raw));
      }
      assert.deepStrictEqual(sanitise({ windows: [{ paths: [1, null, "/seqs/a.gb"] }] }, all), [
        { paths: ["/seqs/a.gb"], activePath: "/seqs/a.gb" },
      ]);
    });
  });

  describe("on disk", () => {
    let dir;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "ove-session-"));
      session.setStoreDir(dir);
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      session.setStoreDir(null);
    });

    const touch = (name) => {
      const p = path.join(dir, name);
      fs.writeFileSync(p, "LOCUS test\n");
      return p;
    };

    it("round-trips a session through the file", () => {
      const a = touch("a.gb");
      const b = touch("b.gb");
      session.save([{ paths: [a, b], activePath: b }]);
      assert.deepStrictEqual(session.restore(), [{ paths: [a, b], activePath: b }]);
    });

    it("restores nothing when there is no file", () => {
      assert.deepStrictEqual(session.restore(), []);
    });

    it("restores nothing when the file is corrupt", () => {
      fs.writeFileSync(session.storePath(), "{ not json");
      assert.deepStrictEqual(session.restore(), []);
    });

    it("leaves out files deleted between saving and restoring", () => {
      const a = touch("a.gb");
      const b = touch("b.gb");
      session.save([{ paths: [a, b], activePath: b }]);
      fs.rmSync(b);
      assert.deepStrictEqual(session.restore(), [{ paths: [a], activePath: a }]);
    });

    it("keeps several windows apart, in order", () => {
      const a = touch("a.gb");
      const b = touch("b.gb");
      session.save([{ paths: [a] }, { paths: [b] }]);
      assert.deepStrictEqual(session.restore().map((w) => w.paths), [[a], [b]]);
    });

    it("clears to nothing", () => {
      session.save([{ paths: [touch("a.gb")] }]);
      session.clear();
      assert.deepStrictEqual(session.restore(), []);
    });
  });
});
