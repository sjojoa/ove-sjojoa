// The editor window's own File menu gets the file-level items too (#21).
//
// There are two File menus: the macOS menu bar's, built in the main process
// (src/main_utils/menu.js), and OVE's, inside the window. The first could open
// a file and knew nothing about the sequence in front of you; the second knew
// all about the sequence and could not open anything else. The menu a few
// pixels from the sequence is the one people reach for, so it carries both
// halves now.
//
// Nothing is reimplemented here. Each item calls the main process, which runs
// the same function the system menu runs, so the two menus cannot drift apart.
//
// The shortcuts are shown but not bound: the system menu owns Cmd+N, Cmd+O and
// Shift+Cmd+T, and registering them again here would fire them twice.
(function () {
  // Pushed from main whenever the recent list or the closed-window stack
  // changes, because the menu is built during a render and cannot wait on IPC.
  let state = { recent: [], canReopenClosedWindow: false };

  const send = (channel, arg) => window.api && window.api.send(channel, arg);
  const basename = (p) => p.slice(p.lastIndexOf("/") + 1);
  const dirname = (p) => {
    const dir = p.slice(0, p.lastIndexOf("/"));
    return dir.slice(dir.lastIndexOf("/") + 1);
  };

  // Two files can share a basename, so show the parent folder to tell them
  // apart -- the same rule the system menu uses.
  function labelFor(filePath, all) {
    const base = basename(filePath);
    const twice = all.filter((o) => basename(o) === base).length > 1;
    return twice ? `${base} — ${dirname(filePath)}` : base;
  }

  function recentSubmenu() {
    const recent = state.recent || [];
    if (!recent.length) return [{ text: "No Recent Files", disabled: true }];
    return [
      ...recent.map((filePath, i) => ({
        text: labelFor(filePath, recent),
        tooltip: filePath,
        hotkey: i < 9 ? `mod+${i + 1}` : undefined,
        onClick: () => send("ove_menuOpenPath", filePath),
      })),
      { divider: "" },
      { text: "Clear Menu", onClick: () => send("ove_menuClearRecent") },
    ];
  }

  function items() {
    return [
      {
        text: "New File",
        icon: "document",
        hotkey: "mod+n",
        onClick: () => send("ove_menuNewFile"),
      },
      {
        text: "Open…",
        icon: "folder-open",
        hotkey: "mod+o",
        onClick: () => send("ove_menuOpen"),
      },
      { text: "Open Recent", icon: "history", submenu: recentSubmenu() },
      {
        text: "Reopen Last Closed Window",
        icon: "undo",
        hotkey: "mod+shift+t",
        disabled: !state.canReopenClosedWindow,
        onClick: () => send("ove_menuReopenLastClosedWindow"),
      },
      { divider: "" },
    ];
  }

  function menuFilter(menu) {
    return menu.map((top) => {
      if (!top || top.text !== "File" || !Array.isArray(top.submenu)) return top;
      return Object.assign({}, top, { submenu: [...items(), ...top.submenu] });
    });
  }

  // OVE caches the filtered menu, and its cache key is normally the filter
  // function itself -- so a filter that keeps its identity is called exactly
  // once and its answer is kept for the life of the editor. Handing over a new
  // function does not help either: menuFilter is a creation-time prop and
  // updateEditor does not propagate it.
  //
  // scripts/patch-ove.js keys that cache on window.oveMenuVersion instead.
  // Bumping it here is what lets the menu change, and it only changes when the
  // contents actually do, so the menu is not rebuilt on every render.
  let signature = "";
  const onChange = [];

  function setState(next) {
    const merged = Object.assign({ recent: [], canReopenClosedWindow: false }, next);
    const sig = JSON.stringify([merged.recent, merged.canReopenClosedWindow]);
    if (sig === signature) return false;
    signature = sig;
    state = merged;
    window.oveMenuVersion = (window.oveMenuVersion || 0) + 1;
    onChange.forEach((fn) => fn());
    return true;
  }

  if (window.api && window.api.on) window.api.on("ove_menuState", setState);

  window.oveFileMenu = {
    menuFilter,
    setState,
    items,
    onChange: (fn) => onChange.push(fn),
  };
})();
