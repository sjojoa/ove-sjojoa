// tnr: We now only access the ipcRenderer from here and
// create a bridge called "api" to communicate back to the
// main process from renderer. I also am now setting the initial sequence data
// using a querystring - https://stackoverflow.com/questions/38335004/how-to-pass-parameters-from-main-process-to-render-processes-in-electron/38401579#38401579

const { ipcRenderer, contextBridge } = require("electron");

// Adds an object 'api' to the global window object:
// Channels the main process is allowed to push to this window (tab moves).
const INBOUND = [
  "ove_addTab",
  "ove_closeTab",
  "ove_selectAll",
  "ove_find",
  "ove_warn",
  // the window or the app is closing: ask about unsaved tabs first (#8)
  "ove_requestClose",
  // a restored window bringing its last-active tab back to the front (#7)
  "ove_activateTab",
  // the recent-file list and whether a closed window can be reopened, for the
  // editor window's own File menu (#21)
  "ove_menuState",
  // File > Version History: the menu asking this window which file is in
  // front, and what to do with its history (#6)
  "ove_menuHistory",
];

contextBridge.exposeInMainWorld("api", {
  send: async (type, arg) => {
    return await ipcRenderer.invoke(type, arg);
  },
  on: (channel, cb) => {
    if (!INBOUND.includes(channel)) return;
    ipcRenderer.on(channel, (event, payload) => cb(payload));
  },
});

// Whether a first tab is on its way as a message. If it is, the renderer must
// not open an empty scratch tab in front of it; the sequence itself arrives
// through "ove_addTab" like every other tab.
const urlParams = new URLSearchParams(global.location.search);
contextBridge.exposeInMainWorld("oveHasPendingTab", urlParams.get("pending") === "1");

// function getParameterByName(name, url ) {
//   name = name.replace(/[\[\]]/g, '\\$&');
//   const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
//       results = regex.exec(url);
//   if (!results) return null;
//   if (!results[2]) return '';
//   return decodeURIComponent(results[2].replace(/\+/g, ' '));
// }