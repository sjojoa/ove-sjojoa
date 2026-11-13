// What was open when the app last closed, so it can be opened again (#7).
//
// Stored as JSON in the app's userData directory, next to recent-files.json
// and on the same principle: a small file, rewritten whole, that starts clean
// if it is missing or corrupt. Losing it costs the user one morning's tab
// strip, so nothing here throws.
//
// The shape is a list of windows, each a list of file paths plus which of them
// was in front:
//
//   { "windows": [ { "paths": ["/seqs/vector.gb", "/seqs/insert.gb"],
//                    "activePath": "/seqs/insert.gb" } ] }
//
// Only file-backed tabs are in it. A sequence that was never saved has no path
// to reopen, and resurrecting a half-built construct from nowhere would be
// worse than losing it — at the moment of closing, #8 is what offers to save it.
const fs = require("fs");
const path = require("path");

let storeDir = null;
// electron's app is only reachable inside the app; tests set the directory.
function dir() {
  if (storeDir) return storeDir;
  // eslint-disable-next-line global-require
  return require("electron").app.getPath("userData");
}
const setStoreDir = (d) => {
  storeDir = d;
};
const storePath = () => path.join(dir(), "session.json");

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
};

// Anything could be in the file: it is on disk, between versions, and users
// edit things. Take only what has the right shape.
function sanitise(raw, exists = isFile) {
  const windows = raw && Array.isArray(raw.windows) ? raw.windows : [];
  return windows
    .map((w) => {
      const paths = (Array.isArray(w && w.paths) ? w.paths : [])
        .filter((p) => typeof p === "string" && p)
        .map((p) => path.resolve(p))
        // a file moved or deleted between sessions is skipped quietly; an
        // error dialog at startup over last week's scratch file helps nobody
        .filter(exists);
      const seen = new Set();
      const unique = paths.filter((p) => !seen.has(p) && seen.add(p));
      const activePath =
        typeof (w && w.activePath) === "string" && unique.includes(path.resolve(w.activePath))
          ? path.resolve(w.activePath)
          : unique[0];
      return { paths: unique, activePath };
    })
    .filter((w) => w.paths.length);
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8"));
  } catch (e) {
    return null; // no file yet, or it got corrupted: no session to restore
  }
}

// The windows to reopen, missing files already dropped.
function restore() {
  return sanitise(read());
}

function save(windows) {
  const clean = sanitise({ windows }, () => true); // the files are open, so they exist
  try {
    fs.writeFileSync(storePath(), JSON.stringify({ windows: clean }, null, 2));
  } catch (e) {
    console.error("could not save the session:", e);
  }
  return clean;
}

const clear = () => save([]);

module.exports = { restore, save, clear, sanitise, setStoreDir, storePath };
