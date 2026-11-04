/* eslint-disable no-console*/
// Modules to control application life and create native browser window
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const bioParsers = require("bio-parsers");
const fs = require("fs");
const createMenu = require("./src/main_utils/menu");
const windowStateKeeper = require("electron-window-state");
const { autoUpdater } = require("electron-updater");

let isAppReady = false;
let isMacOpenTriggered = false;
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
const windows = [];
const recentFiles = require("./src/main_utils/recentFiles");

const rebuildMenu = () =>
  createMenu({ windows, createWindow, getSeqJsonFromPath, openPath });

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
    const res = await bioParsers.anyToJson(data, { fileName });
    return res[0].parsedSequence;
  } catch (error) {
    console.error(`error:`, error);
    return {};
  }
}

function waitTillAppReady() {
  return new Promise((resolve, reject) => {
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
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1000,
    defaultHeight: 800,
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

  // Emitted when the window is closed.
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
    newWindow = null;
  });
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
  autoUpdater.checkForUpdatesAndNotify();
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
    if (startupPaths.length) startupPaths.forEach((p) => openPath(p));
    else createWindow({});
  }
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
  (event, { sequenceDataToSave, filePath, isSaveAs }) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);

    const ext = path.extname(filePath);

    let formattedSeqString;
    if (ext === ".fasta") {
      formattedSeqString = bioParsers.jsonToFasta(sequenceDataToSave);
    } else if (ext === ".bed") {
      formattedSeqString = bioParsers.jsonToBed(sequenceDataToSave);
    } else if (ext === ".json") {
      formattedSeqString = JSON.stringify(sequenceDataToSave, null, 2);
    } else {
      formattedSeqString = bioParsers.jsonToGenbank(sequenceDataToSave);
    }
    fs.writeFileSync(filePath, formattedSeqString);
    noteRecentFile(filePath);
    !isSaveAs &&
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
  if (w && !w.isDestroyed()) w.close();
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
      filters: [
        {
          name: "Sequences",
          extensions: ["gb", "gbk", "genbank", "dna", "fasta", "fa", "fas", "fna", "ffn", "gff", "gff3", "json", "txt"],
        },
      ],
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

ipcMain.handle("ove_showSaveDialog", async (event, opts) => {
  return dialog.showSaveDialogSync(
    BrowserWindow.fromWebContents(event.sender),
    opts
  );
});

/*  **************************************************  */
