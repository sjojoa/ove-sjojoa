const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// fileMenu.js is a browser script that hangs itself off window; load it into a
// sandbox with just enough of a window to run.
function load(api, oveHistory) {
  const src = fs.readFileSync(path.join(__dirname, "../src/features/fileMenu.js"), "utf8");
  const sent = [];
  const listeners = {};
  const window = {
    oveHistory,
    api: api === undefined
      ? {
          send: (channel, arg) => sent.push([channel, arg]),
          on: (channel, cb) => {
            listeners[channel] = cb;
          },
        }
      : api,
  };
  const sandbox = { window };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { api: window.oveFileMenu, sent, listeners };
}

const fileMenu = () => ({ text: "File", submenu: ["renameSequence", "save", "saveAs"] });
const menu = () => [fileMenu(), { text: "Edit", submenu: ["undo"] }];
const byText = (items, text) => items.find((i) => i && i.text === text);
// fileMenu.js is evaluated in a vm context, so the objects and arrays it builds
// have that realm's prototypes and deepStrictEqual refuses to match them
// against ours. Compare the shape, not the realm.
const plain = (x) => JSON.parse(JSON.stringify(x));

describe("the editor window's File menu (#21)", () => {
  it("puts the file-level items above the sequence-level ones", () => {
    const { api } = load();
    const out = api.menuFilter(menu());
    const file = byText(out, "File").submenu;
    const texts = file.map((i) => (typeof i === "string" ? i : i.text));
    assert.deepStrictEqual(plain(texts.slice(0, 5)), [
      "New File",
      "Open…",
      "Open Recent",
      "Reopen Last Closed Window",
      "Version History",
    ]);
    // a divider, then everything that was already there, untouched and in order
    assert.strictEqual(file[5].divider, "");
    assert.deepStrictEqual(plain(file.slice(6)), ["renameSequence", "save", "saveAs"]);
  });

  it("carries the version-history items when that module is loaded", () => {
    const { api } = load(undefined, {
      submenu: () => [{ text: "Delete All History…", onClick: () => {} }],
    });
    const file = byText(api.menuFilter(menu()), "File").submenu;
    const vh = byText(file, "Version History");
    assert.deepStrictEqual(
      vh.submenu.map((i) => i.text),
      ["Delete All History…"]
    );
  });

  it("shows an empty version-history submenu rather than failing without that module", () => {
    const { api } = load();
    const vh = byText(byText(api.menuFilter(menu()), "File").submenu, "Version History");
    assert.deepStrictEqual(plain(vh.submenu), []);
  });

  it("leaves every other menu alone", () => {
    const { api } = load();
    const out = api.menuFilter(menu());
    assert.deepStrictEqual(byText(out, "Edit"), { text: "Edit", submenu: ["undo"] });
  });

  it("shows the system menu's shortcuts without binding them", () => {
    const { api } = load();
    const file = byText(api.menuFilter(menu()), "File").submenu;
    assert.strictEqual(byText(file, "New File").hotkey, "mod+n");
    assert.strictEqual(byText(file, "Open…").hotkey, "mod+o");
    assert.strictEqual(byText(file, "Reopen Last Closed Window").hotkey, "mod+shift+t");
  });

  it("greys out Reopen Last Closed Window until there is one", () => {
    const { api } = load();
    const disabled = () =>
      byText(byText(api.menuFilter(menu()), "File").submenu, "Reopen Last Closed Window").disabled;
    assert.strictEqual(disabled(), true);
    api.setState({ recent: [], canReopenClosedWindow: true });
    assert.strictEqual(disabled(), false);
  });

  it("says so when there are no recent files", () => {
    const { api } = load();
    const recent = byText(byText(api.menuFilter(menu()), "File").submenu, "Open Recent").submenu;
    assert.deepStrictEqual(plain(recent), [{ text: "No Recent Files", disabled: true }]);
  });

  it("lists recent files, numbering the first nine", () => {
    const { api } = load();
    const paths = Array.from({ length: 10 }, (_, i) => `/seqs/p${i}.gb`);
    api.setState({ recent: paths });
    const recent = byText(byText(api.menuFilter(menu()), "File").submenu, "Open Recent").submenu;
    assert.strictEqual(recent[0].text, "p0.gb");
    assert.strictEqual(recent[0].hotkey, "mod+1");
    assert.strictEqual(recent[8].hotkey, "mod+9");
    assert.strictEqual(recent[9].hotkey, undefined, "the tenth gets no number");
    assert.strictEqual(recent[10].divider, "");
    assert.strictEqual(recent[11].text, "Clear Menu");
  });

  it("disambiguates two recent files with the same name by their folder", () => {
    const { api } = load();
    api.setState({ recent: ["/seqs/vectors/pA.gb", "/seqs/inserts/pA.gb", "/seqs/other.gb"] });
    const recent = byText(byText(api.menuFilter(menu()), "File").submenu, "Open Recent").submenu;
    assert.strictEqual(recent[0].text, "pA.gb — vectors");
    assert.strictEqual(recent[1].text, "pA.gb — inserts");
    assert.strictEqual(recent[2].text, "other.gb", "a unique name is left plain");
  });

  it("asks the main process to act rather than doing anything itself", () => {
    const { api, sent } = load();
    api.setState({ recent: ["/seqs/a.gb"], canReopenClosedWindow: true });
    const file = byText(api.menuFilter(menu()), "File").submenu;
    byText(file, "New File").onClick();
    byText(file, "Open…").onClick();
    byText(file, "Reopen Last Closed Window").onClick();
    const recent = byText(file, "Open Recent").submenu;
    recent[0].onClick();
    byText(recent, "Clear Menu").onClick();
    // JSON turns the absent second argument into null; the channel and any
    // argument are what matter
    assert.deepStrictEqual(plain(sent), [
      ["ove_menuNewFile", null],
      ["ove_menuOpen", null],
      ["ove_menuReopenLastClosedWindow", null],
      ["ove_menuOpenPath", "/seqs/a.gb"],
      ["ove_menuClearRecent", null],
    ]);
  });

  it("takes its state from the main process's push", () => {
    const { api, listeners } = load();
    assert.strictEqual(typeof listeners.ove_menuState, "function");
    listeners.ove_menuState({ recent: ["/seqs/z.gb"], canReopenClosedWindow: true });
    const file = byText(api.menuFilter(menu()), "File").submenu;
    assert.strictEqual(byText(file, "Open Recent").submenu[0].text, "z.gb");
    assert.strictEqual(byText(file, "Reopen Last Closed Window").disabled, false);
  });

  it("still builds a menu with no IPC bridge at all", () => {
    const { api } = load(null);
    const file = byText(api.menuFilter(menu()), "File").submenu;
    assert.strictEqual(byText(file, "New File").text, "New File");
    byText(file, "New File").onClick(); // must not throw
  });
});
