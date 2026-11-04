const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

// stub out electron so the main-process modules load under plain node
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ove-recent-"));
let built = null;
const electronStub = {
  app: { getPath: () => tmp, addRecentDocument() {}, clearRecentDocuments() {} },
  Menu: { buildFromTemplate: (t) => (built = t), setApplicationMenu() {} },
  dialog: { showOpenDialog: async () => ({ filePaths: [] }) },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === "electron" ? electronStub : origLoad.call(this, req, ...rest);
};

const recentFiles = require("../src/main_utils/recentFiles");
const createMenu = require("../src/main_utils/menu");

const fileMenu = () => built.find((m) => m.label === "File");
const editMenu = () => built.find((m) => m.label === "Edit");
const openRecent = () => fileMenu().submenu.find((i) => i.label === "Open Recent");
const makeFile = (name) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, "LOCUS test\n");
  return p;
};

describe("Open Recent", () => {
  beforeEach(() => recentFiles.clear());

  it("shows a disabled placeholder when nothing has been opened", () => {
    createMenu({ createWindow() {}, getSeqJsonFromPath() {}, openPath() {} });
    assert.deepStrictEqual(openRecent().submenu, [{ label: "No Recent Files", enabled: false }]);
  });

  it("lists files most-recent-first, without duplicates", () => {
    const a = makeFile("a.gb");
    const b = makeFile("b.gb");
    recentFiles.add(a);
    recentFiles.add(b);
    recentFiles.add(a); // re-opening a moves it back to the top
    createMenu({ createWindow() {}, getSeqJsonFromPath() {}, openPath() {} });
    assert.deepStrictEqual(openRecent().submenu.filter((i) => i.toolTip).map((i) => i.label), ["a.gb", "b.gb"]);
  });

  it("keeps at most 10 entries", () => {
    for (let i = 0; i < 14; i++) recentFiles.add(makeFile(`f${i}.gb`));
    assert.strictEqual(recentFiles.list().length, 10);
    assert.strictEqual(path.basename(recentFiles.list()[0]), "f13.gb");
  });

  it("drops files that no longer exist", () => {
    const gone = makeFile("gone.gb");
    const kept = makeFile("kept.gb");
    recentFiles.add(gone);
    recentFiles.add(kept);
    fs.unlinkSync(gone);
    assert.deepStrictEqual(recentFiles.list().map((p) => path.basename(p)), ["kept.gb"]);
  });

  it("disambiguates files that share a name, by folder", () => {
    const sub = path.join(tmp, "sub");
    fs.mkdirSync(sub, { recursive: true });
    const one = makeFile("plasmid.gb");
    const two = path.join(sub, "plasmid.gb");
    fs.writeFileSync(two, "LOCUS test\n");
    recentFiles.add(one);
    recentFiles.add(two);
    createMenu({ createWindow() {}, getSeqJsonFromPath() {}, openPath() {} });
    const labels = openRecent().submenu.filter((i) => i.toolTip).map((i) => i.label);
    assert.deepStrictEqual(labels, ["plasmid.gb — sub", `plasmid.gb — ${path.basename(tmp)}`]);
  });

  it("clicking an entry opens that exact path", () => {
    const a = makeFile("click.gb");
    recentFiles.add(a);
    const opened = [];
    createMenu({ createWindow() {}, getSeqJsonFromPath() {}, openPath: (p) => opened.push(p) });
    openRecent().submenu[0].click();
    assert.deepStrictEqual(opened, [a]);
  });

  it("Clear Menu empties the list", () => {
    recentFiles.add(makeFile("x.gb"));
    createMenu({ createWindow() {}, getSeqJsonFromPath() {}, openPath() {} });
    openRecent().submenu.find((i) => i.label === "Clear Menu").click();
    assert.strictEqual(recentFiles.list().length, 0);
    assert.deepStrictEqual(openRecent().submenu, [{ label: "No Recent Files", enabled: false }]);
  });
});

describe("Select All", () => {
  const selectAllItem = () => {
    createMenu({ createWindow() {}, getSeqJsonFromPath() {}, openPath() {} });
    return editMenu().submenu.find((i) => i.label === "Select All");
  };

  it("claims Cmd+A, which macOS otherwise never delivers to a text field", () => {
    assert.strictEqual(selectAllItem().accelerator, "CmdOrCtrl+A");
  });

  it("asks the renderer to decide between the text field and the sequence", () => {
    const sent = [];
    const win = { isDestroyed: () => false, webContents: { send: (...a) => sent.push(a) } };
    selectAllItem().click(null, win);
    assert.deepStrictEqual(sent, [["ove_selectAll"]]);
  });

  it("does nothing when the window is already gone", () => {
    const sent = [];
    const win = { isDestroyed: () => true, webContents: { send: (...a) => sent.push(a) } };
    selectAllItem().click(null, win);
    selectAllItem().click(null, undefined);
    assert.deepStrictEqual(sent, []);
  });
});
