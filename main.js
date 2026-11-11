/* eslint-disable no-console*/
// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require("electron");
const path = require("path");
const bioParsers = require("bio-parsers");
const fs = require("fs");
const createMenu = require("./src/main_utils/menu");
const windowStateKeeper = require("electron-window-state");

let isAppReady = false;
let isMacOpenTriggered = false;
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
const windows = [];
// The windows closed during this run, most recent first, for
// File > Reopen Last Closed Window (#7). In memory only: it is about undoing a
// misclick in the session you are in. Declared up here because the menu is
// built while this file is still being evaluated.
const closedWindows = [];
const REOPEN_DEPTH = 10;
const recentFiles = require("./src/main_utils/recentFiles");
const session = require("./src/main_utils/session");
const taggedText = require("./src/features/taggedText");
const pastedBases = require("./src/features/pastedBases");
const sequenceFileFilters = require("./src/main_utils/sequenceFileFilters");

// Colours for the tagged-text exporter: a feature's colour is only worth
// writing out when it is not simply the colour its type already gets.
const featureTypeColor = (type) => {
  try {
    return (require("@teselagen/sequence-utils").getFeatureToColorMap({
      includeHidden: true,
    }) || {})[type];
  } catch (e) {
    return undefined;
  }
};

const rebuildMenu = () =>
  createMenu({
    windows,
    createWindow,
    getSeqJsonFromPath,
    openPath,
    reopenLastClosedWindow: () => reopenLastClosedWindow(),
    canReopenClosedWindow: () => canReopenClosedWindow(),
  });

// Open a file by path: used by File > Open, File > Open Recent and the Dock's
// recent documents. Records it in the recent list and refreshes the menu.
// Opens are queued: several files arriving at once (a multi-select in the Open
// dialog, or dropping files on the Dock icon) used to race, each finding no
// window yet and creating its own. Queuing means the first makes the window and
// the rest become tabs in it.
let openQueue = Promise.resolve();
function openPath(filePath) {
  openQueue = openQueue.then(() => openPathNow(filePath)).catch((e) => console.error(e));
  return openQueue;
}

async function openPathNow(filePath) {
  try {
    const initialSeqJson = await getSeqJsonFromPath(filePath);
    if (!initialSeqJson || !initialSeqJson.sequence) {
      throw new Error("no sequence could be read from this file");
    }
    await openInTabOrWindow({ seqJson: initialSeqJson, filePath });
    noteRecentFile(filePath);
  } catch (error) {
    console.error(`could not open ${filePath}:`, error);
    recentFiles.remove(filePath);
    rebuildMenu();
    dialog.showMessageBox({
      type: "warning",
      message: "Could not open this file",
      detail: `${filePath}\n\n${error.message}`,
    });
  }
}

// Add to the recent list and redraw the menu only when the order actually changed.
function noteRecentFile(filePath) {
  if (recentFiles.add(filePath)) rebuildMenu();
}

// Prefer adding a tab to the window the user is in; fall back to a new window.
async function openInTabOrWindow({ seqJson, filePath, preferWindow }) {
  const target =
    preferWindow ||
    BrowserWindow.getFocusedWindow() ||
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.isMinimized());
  if (target) {
    sendTab(target, { seqJson, filePath });
    target.show();
    return target;
  }
  await createWindow({ initialSeqJson: seqJson, filePath });
  return null;
}

// A freshly created window cannot receive "add tab" until its page has loaded
// and registered the listener, so hold messages until it says it is ready.
function sendTab(win, payload) {
  if (!win || win.isDestroyed()) return;
  if (win.__oveReady) win.webContents.send("ove_addTab", payload);
  else (win.__ovePendingTabs = win.__ovePendingTabs || []).push(payload);
}

ipcMain.handle("ove_rendererReady", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.__oveReady = true;
  const queued = win.__ovePendingTabs || [];
  win.__ovePendingTabs = [];
  queued.forEach((payload) => win.webContents.send("ove_addTab", payload));
  const messages = win.__ovePendingMessages || [];
  win.__ovePendingMessages = [];
  messages.forEach(({ channel, payload }) => win.webContents.send(channel, payload));
});

const pointInBounds = (b, x, y) =>
  x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;

rebuildMenu();

async function getSeqJsonFromPath(_filePath) {
  const filePath = _filePath || process.argv[1];
  // const filePath = _filePath || process.argv[2] || process.argv[1];
  if (filePath === ".") return;
  const data = fs.readFileSync(path.resolve(filePath));
  //open, read, handle file
  if (!data) return;
  const fileName = filePath.replace(/^.*[\\/]/, "");
  try {
    if (fileName.endsWith(".json") && (data.sequence || data.proteinSequence)) {
      return data;
    }
    // The lab's inline-tagged format: bio-parsers would read it as one long
    // run of bases with the tags treated as garbage, so catch it first. A .txt
    // file is only tagged text if it actually carries tag pairs; a plain
    // sequence in a .txt still goes to bio-parsers.
    const asText = data.toString("utf8");
    if (taggedText.looksTagged(asText)) {
      const { sequenceData, warnings } = taggedText.taggedToSequenceData(asText);
      if (!sequenceData.name || sequenceData.name === "Untitled Sequence") {
        sequenceData.name = fileName.replace(/\.[^.]*$/, "");
      }
      if (warnings.length) sequenceData.__taggedWarnings = warnings;
      return sequenceData;
    }
    const res = await bioParsers.anyToJson(data, { fileName });
    return res[0].parsedSequence;
  } catch (error) {
    console.error(`error:`, error);
    return {};
  }
}

function waitTillAppReady() {
  return new Promise((resolve) => {
    const waitTillReadyInterval = setInterval(() => {
      if (isAppReady) {
        resolve();
        clearInterval(waitTillReadyInterval);
      }
    }, 100);
  });
}

async function createWindow({ initialSeqJson, filePath, windowToUse, position } = {}) {
  await waitTillAppReady();
  //if no windowVars are passed then we should
  // Create the browser window.

  if (filePath) {
    let alreadyOpen = false;
    windows.forEach((w) => {
      if (w.__filePath === filePath) {
        w.bw.show();
        alreadyOpen = true;
      }
    });
    if (alreadyOpen) {
      return;
    }
  }
  // Sized to the screen it opens on, not a fixed 1000x800: the Add/Edit
  // Primer dialog alone is ~900px tall once the hybridisation view is in it,
  // and a window shorter than its own dialogs makes them scroll from the
  // first moment. electron-window-state still remembers whatever size the
  // window is left at, so this only sets where a new one starts.
  const { workAreaSize } = screen.getPrimaryDisplay();
  const mainWindowState = windowStateKeeper({
    defaultWidth: Math.min(1600, Math.max(1000, workAreaSize.width - 40)),
    defaultHeight: Math.min(1100, Math.max(800, workAreaSize.height - 40)),
  });
  // a tab torn off with the mouse opens where it was dropped
  const origin = position || { x: mainWindowState.x, y: mainWindowState.y };

  let newWindow =
    windowToUse ||
    new BrowserWindow({
      x: origin.x,
      y: origin.y,
      width: mainWindowState.width,
      height: mainWindowState.height,
      show: false,
      webPreferences: {
        contextIsolation: true,
        // nodeIntegration: true, //we don't want to enable this because it is a security risk and slows down the app
        preload: path.join(__dirname, "src/preload.js"),
      },
    });

  newWindow.once("ready-to-show", () => {
    newWindow.show();
  });

  // Let us register listeners on the window, so we can update the state
  // automatically (the listeners will be removed when the window is closed)
  // and restore the maximized or full screen state
  mainWindowState.manage(newWindow);

  !windowToUse &&
    windows.push({
      bw: newWindow,
      //set a __filePath property so we can reference this if a user tries to open the same file multiple times
      __filePath: filePath,
    });
console.log(`initialSeqJson:`,initialSeqJson)
  newWindow.loadFile("index.html", {
    query: { initialSeqJson: JSON.stringify(initialSeqJson), filePath },
  });

  // Open the DevTools.
  // newWindow.webContents.openDevTools()

  // Unsaved changes (#8): hold the close while the renderer asks about each
  // dirty tab. __forceClose is set once that has happened (or by the renderer
  // closing its own last tab), so the second close goes straight through.
  newWindow.on("close", function (event) {
    if (newWindow.__forceClose) return;
    event.preventDefault();
    const bw = newWindow;
    askRendererToClose(bw).then((ok) => {
      if (!ok || bw.isDestroyed()) return;
      bw.__forceClose = true;
      bw.close();
    });
  });

  // Emitted when the window is closed.
  const closingWindow = newWindow;
  newWindow.on("closed", function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    let indexToSplice;
    windows.forEach((w, i) => {
      if (w.bw === newWindow) {
        indexToSplice = i;
      }
    });
    windows.splice(indexToSplice, 1);
    const snapshot = closingWindow.__session;
    rememberClosedWindow(snapshot);
    // Closing the last window is the end of a session as far as restoring goes.
    // On macOS the app lives on with no windows, so waiting for the quit would
    // mean saving nothing. A window closed while others remain is not the end
    // of anything, and a quit writes the whole set itself.
    if (!quitting && !windows.length && snapshot) session.save([snapshot]);
    newWindow = null;
  });

  return newWindow;
}

// ------------------------------------------- reopen what was open (#7)
//
// One window per saved window, its tabs in the order they were in. The first
// path makes the window (a window created empty would leave a stray Untitled
// tab beside the restored ones); the rest are sent to that same window, which
// queues them until its page is ready.
async function openWindowWithPaths({ paths, activePath }) {
  let target = null;
  for (const filePath of paths) {
    // eslint-disable-next-line no-await-in-loop
    const seqJson = await getSeqJsonFromPath(filePath).catch(() => null);
    // a file that has become unreadable since last time is skipped, quietly
    if (!seqJson || !seqJson.sequence) continue;
    if (target) {
      sendTab(target, { seqJson, filePath });
    } else {
      // eslint-disable-next-line no-await-in-loop
      target = await createWindow({ initialSeqJson: seqJson, filePath });
    }
    noteRecentFile(filePath);
  }
  if (target && activePath && activePath !== paths[0]) {
    sendWhenReady(target, "ove_activateTab", { filePath: activePath });
  }
  return target;
}

// Like sendTab, but for any message a freshly created window cannot receive
// until its page has registered its listeners.
function sendWhenReady(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  if (win.__oveReady) win.webContents.send(channel, payload);
  else (win.__ovePendingMessages = win.__ovePendingMessages || []).push({ channel, payload });
}

function rememberClosedWindow(snapshot) {
  if (!snapshot || !snapshot.paths || !snapshot.paths.length) return;
  closedWindows.unshift(snapshot);
  closedWindows.length = Math.min(closedWindows.length, REOPEN_DEPTH);
  rebuildMenu();
}

function reopenLastClosedWindow() {
  const snapshot = closedWindows.shift();
  if (!snapshot) return;
  rebuildMenu();
  openWindowWithPaths(snapshot);
}

function canReopenClosedWindow() {
  return closedWindows.length > 0;
}

app.on("open-file", async (event, path) => {
  isMacOpenTriggered = true;
  //mac only
  event.preventDefault();
  console.log(`open-file`)
  try {
    console.log("trying to open gb file");
    openPath(path); // queued, so several files at once land as tabs
  } catch (e) {
    console.error(`e73562891230:`, e);
  }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", async () => {
  console.info(`App Starting Up`);
  // No auto-update: this fork publishes no update feed, and the updater threw
  // an unhandled rejection on every launch looking for one.
  isAppReady = true;
  if (!windows.length && !isMacOpenTriggered) {
    // Files to open are argv[1..] in a packaged app but argv[2..] under
    // `electron .`, so take every argument that is an actual file. They go
    // through the same queue as any other open, so they become tabs in one
    // window rather than a window each. (This was `filePath: path` -- the node
    // path module, not a file path.)
    const startupPaths = process.argv
      .slice(1)
      .filter((a) => a && a !== "." && !a.startsWith("-") && fs.existsSync(a) && fs.statSync(a).isFile());
    if (startupPaths.length) {
      // Double-clicking a .gb opens that file and nothing else: asked for one
      // sequence, get one sequence.
      startupPaths.forEach((p) => openPath(p));
    } else {
      // Otherwise pick up where the last session left off (#7). Every path in
      // it has already been checked to still exist.
      const lastSession = session.restore();
      if (lastSession.length) {
        // Queued like any other open, so the windows come back in order rather
        // than racing each other for focus.
        lastSession.forEach((snapshot) => {
          openQueue = openQueue
            .then(() => openWindowWithPaths(snapshot))
            .catch((e) => console.error(e));
        });
        // If every file turned out to be unreadable there would be no window
        // at all, which looks like a failed launch.
        openQueue = openQueue.then(() => {
          if (!windows.length) createWindow({});
        });
      } else {
        createWindow({});
      }
    }
  }
});

// Cmd+Q, the Quit menu item, and a logout: same guard, every window in turn.
// The quit is vetoed outright while the dialogs are up, because Electron tears
// windows down the moment before-quit returns.
let quitConfirmed = false;
// set once the session file has been written for a quit, so the individual
// window closes that follow do not overwrite it with just the last one
let quitting = false;
app.on("before-quit", (event) => {
  if (quitConfirmed) return;
  const open = windows.filter((w) => w.bw && !w.bw.isDestroyed());
  if (!open.length) return;
  event.preventDefault();
  (async () => {
    for (const w of open) {
      if (w.bw.isDestroyed()) continue;
      w.bw.focus();
      // eslint-disable-next-line no-await-in-loop
      const ok = await askRendererToClose(w.bw);
      if (!ok) return; // Cancel anywhere cancels the whole quit
    }
    quitConfirmed = true;
    // Everything still open at the moment of the quit is what comes back (#7),
    // in window order. The per-window snapshots arrived with the answers above,
    // so this is what each window held before anything was torn down.
    quitting = true;
    const snapshots = open.map((w) => w.bw.__session).filter((snap) => snap && snap.paths && snap.paths.length);
    if (snapshots.length) session.save(snapshots);
    open.forEach((w) => {
      if (!w.bw.isDestroyed()) w.bw.__forceClose = true;
    });
    app.quit();
  })();
});

// Quit when all windows are closed.
app.on("window-all-closed", function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (!windows.length) {
    console.log(`onActivate`);
    createWindow();
  }
});

// ipcMain.on("restart_app", () => {
//   setImmediate(() => {
//     autoUpdater.quitAndInstall();
//   });
// });

/*  HANDLE THE API CALLS FROM THE RENDERER PROCESS  */

ipcMain.handle(
  "ove_saveFile",
  (event, { sequenceDataToSave, filePath }) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);

    const ext = path.extname(filePath);

    let formattedSeqString;
    if (ext === ".fasta") {
      formattedSeqString = bioParsers.jsonToFasta(sequenceDataToSave);
    } else if (ext === ".bed") {
      formattedSeqString = bioParsers.jsonToBed(sequenceDataToSave);
    } else if (ext === ".json") {
      formattedSeqString = JSON.stringify(sequenceDataToSave, null, 2);
    } else if (ext === ".txt") {
      const rendered = taggedText.renderTagged(sequenceDataToSave, {
        attrs: "minimal",
        typeColor: featureTypeColor,
      });
      formattedSeqString = rendered.text;
      if (rendered.warnings.length) {
        browserWindow &&
          browserWindow.webContents.send("ove_warn", {
            title: "Exported as tagged text",
            messages: rendered.warnings,
          });
      }
    } else {
      formattedSeqString = bioParsers.jsonToGenbank(sequenceDataToSave);
    }
    fs.writeFileSync(filePath, formattedSeqString);
    noteRecentFile(filePath);
    // Save and Save As both retarget the tab, so the window's record of which
    // file it is showing follows either way.
    windows.forEach((w) => {
      if (w.bw === browserWindow) {
        //update the __filePath prop we're saving on the window to prevent opening the same file twice
        w.__filePath = filePath;
      }
    });
  }
);

// Cloning menu: open a newly built construct / product in its own window
ipcMain.handle("ove_openSequenceInNewWindow", (event, initialSeqJson) => {
  // now opens as a tab in the window that asked for it
  openInTabOrWindow({
    seqJson: initialSeqJson,
    preferWindow: BrowserWindow.fromWebContents(event.sender),
  });
});

// A tab was dragged out of its strip and released. If it landed on another
// window, move it there; otherwise open a new window where it was dropped.
ipcMain.handle("ove_tabDropped", (event, { screenX, screenY, payload, isOnlyTab }) => {
  const source = BrowserWindow.fromWebContents(event.sender);
  const target = BrowserWindow.getAllWindows().find(
    (w) =>
      w !== source &&
      !w.isDestroyed() &&
      !w.isMinimized() &&
      pointInBounds(w.getBounds(), screenX, screenY)
  );
  if (target) {
    sendTab(target, payload);
    target.focus();
    return { accepted: true, movedTo: "window" };
  }
  // dropping the only tab of a window onto empty space would just recreate
  // the same window, so leave it where it is
  if (isOnlyTab) return { accepted: false };
  createWindow({
    initialSeqJson: payload.seqJson,
    filePath: payload.filePath,
    position: { x: Math.round(screenX - 180), y: Math.round(screenY - 24) },
  });
  return { accepted: true, movedTo: "new" };
});

ipcMain.handle("ove_closeThisWindow", (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  // the renderer only sends this once its last tab has been closed, which
  // means the unsaved-changes guard has already run for every tab in it
  if (w && !w.isDestroyed()) {
    w.__forceClose = true;
    w.close();
  }
});

// ------------------------------------------- unsaved changes on close (#8)
//
// A window's close button and Cmd+Q are main-process events, and the dirty
// flag lives in the renderer, so main vetoes its own close and asks. The
// renderer walks its tabs, puts up one dialog at a time, and answers once.
const pendingCloses = new Map();
let closeToken = 0;

function askRendererToClose(bw) {
  if (!bw || bw.isDestroyed() || !bw.webContents || bw.webContents.isDestroyed()) {
    return Promise.resolve(true);
  }
  const token = `close${++closeToken}`;
  return new Promise((resolve) => {
    pendingCloses.set(token, resolve);
    bw.webContents.send("ove_requestClose", { token });
    // A renderer that never answers must not wedge the app shut. Two minutes
    // is far longer than any dialog and far shorter than "never".
    setTimeout(() => {
      if (pendingCloses.delete(token)) resolve(true);
    }, 120000);
  });
}

ipcMain.handle("ove_closeDecision", (event, { token, ok, session: snapshot }) => {
  const resolve = pendingCloses.get(token);
  if (!resolve) return;
  pendingCloses.delete(token);
  // the last thing this window knew about itself, for #7: kept on the window
  // so both the session file and Reopen Last Closed Window can use it
  const bw = BrowserWindow.fromWebContents(event.sender);
  if (bw && !bw.isDestroyed() && snapshot) bw.__session = snapshot;
  resolve(!!ok);
});

// Save / Save As / Cancel / Don't Save, asked by the main process so the same
// dialog appears whether the close started at a tab's x or at the window's.
// Save overwrites the file the tab came from; Save As asks where to put it,
// which is the way to rename it or move it somewhere else.
ipcMain.handle("ove_confirmClose", async (event, { name, hasFile }) => {
  const bw = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(bw, {
    type: "warning",
    buttons: ["Save", "Save As\u2026", "Cancel", "Don't Save"],
    defaultId: 0,
    cancelId: 2,
    message: `Do you want to save the changes you made to "${name}"?`,
    detail: hasFile
      ? "Save overwrites the file this came from. Save As puts it somewhere else, under any name you like. Your changes will be lost if you don't save them."
      : "This sequence has never been saved to a file, so both Save and Save As will ask where to put it. It will be lost for good if you don't save it.",
  });
  return ["save", "saveAs", "cancel", "discard"][response] || "cancel";
});

ipcMain.handle("ove_focusThisWindow", (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (w && !w.isDestroyed()) w.focus();
});

// Right-clicking a tab: move it to any other open window.
ipcMain.handle("ove_tabContextMenu", (event, { docId, payload }) => {
  const source = BrowserWindow.fromWebContents(event.sender);
  const others = BrowserWindow.getAllWindows().filter(
    (w) => w !== source && !w.isDestroyed()
  );
  const template = [
    {
      label: "Move to New Window",
      click: () => {
        createWindow({ initialSeqJson: payload.seqJson, filePath: payload.filePath });
        source.webContents.send("ove_closeTab", { docId });
      },
    },
  ];
  if (others.length) {
    template.push({ type: "separator" });
    others.forEach((w, i) => {
      template.push({
        label: `Move to ${w.getTitle() || `Window ${i + 1}`}`,
        click: () => {
          sendTab(w, payload);
          w.focus();
          source.webContents.send("ove_closeTab", { docId });
        },
      });
    });
  }
  Menu.buildFromTemplate(template).popup({ window: source });
});

// Cloning menu: pick sequence files (inserts, gel samples) and parse them
ipcMain.handle("ove_pickSequenceFiles", async (event, { multi } = {}) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(event.sender),
    {
      title: "Choose sequence file" + (multi ? "s" : ""),
      properties: ["openFile", ...(multi ? ["multiSelections"] : [])],
      filters: sequenceFileFilters.filters,
    }
  );
  if (canceled) return [];
  const sequences = [];
  for (const filePath of filePaths) {
    const seq = await getSeqJsonFromPath(filePath);
    if (seq && seq.sequence) sequences.push(seq);
  }
  return sequences;
});

// Import dialog: parse text the user pasted, the same way a file would be
// parsed. Lives here because bio-parsers is a main-process dependency, and
// because then paste and open cannot disagree about a format.
ipcMain.handle("ove_parseSequenceText", async (event, { text, name } = {}) => {
  const raw = String(text || "");
  if (!raw.trim()) return { sequences: [], warnings: [], format: null };
  const fileName = name || "pasted";

  if (taggedText.looksTagged(raw)) {
    const { sequenceData, warnings } = taggedText.taggedToSequenceData(raw);
    if (!sequenceData.name || sequenceData.name === "Untitled Sequence") {
      sequenceData.name = fileName;
    }
    return { sequences: [sequenceData], warnings, format: "tagged text" };
  }

  // Bare bases, which is most pastes. See src/features/pastedBases.js for why
  // this does not just go to bio-parsers like everything else.
  if (!pastedBases.isStructured(raw)) {
    const read = pastedBases.rawBases(raw);
    if (!read.ok) return { sequences: [], warnings: [read.reason], format: null };
    return {
      sequences: [
        {
          name: fileName,
          circular: false,
          sequence: read.sequence,
          features: [],
          primers: [],
          parts: [],
        },
      ],
      warnings: read.dropped
        ? [`dropped ${read.dropped} character(s) that are not bases`]
        : [],
      format: "raw bases",
    };
  }

  try {
    const results = await bioParsers.anyToJson(raw, { fileName });
    const warnings = [];
    const sequences = [];
    let format = null;
    results.forEach((res) => {
      (res.messages || []).forEach((m) => {
        const parser = /Parsed using (.+?) Parser/i.exec(m);
        if (parser) format = parser[1];
        else warnings.push(m);
      });
      if (res.parsedSequence && res.parsedSequence.sequence) {
        sequences.push(res.parsedSequence);
      } else if (res.success === false) {
        warnings.push("could not parse that text as a sequence");
      }
    });
    return { sequences, warnings: Array.from(new Set(warnings)), format };
  } catch (error) {
    return { sequences: [], warnings: [error.message], format: null };
  }
});

// Import dialog: "Choose File..." takes the same path as File > Open, so an
// imported file arrives with its path (and lands in Open Recent) like any other.
ipcMain.handle("ove_openFilePicker", async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(
    BrowserWindow.fromWebContents(event.sender),
    {
      filters: sequenceFileFilters.filters,
      properties: ["openFile", "multiSelections"],
    }
  );
  if (canceled) return 0;
  filePaths.forEach((p) => openPath(p));
  return filePaths.length;
});

ipcMain.handle("ove_showSaveDialog", async (event, opts) => {
  return dialog.showSaveDialogSync(
    BrowserWindow.fromWebContents(event.sender),
    opts
  );
});

/*  **************************************************  */
