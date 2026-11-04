// Remembers recently opened/saved sequence files for the File > Open Recent menu.
// Stored as JSON in the app's userData directory, so it survives restarts.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const MAX = 10;
const storePath = () => path.join(app.getPath("userData"), "recent-files.json");

function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return Array.isArray(raw) ? raw.filter((p) => typeof p === "string") : [];
  } catch (e) {
    return []; // no file yet, or it got corrupted: start clean
  }
}

function write(list) {
  try {
    fs.writeFileSync(storePath(), JSON.stringify(list, null, 2));
  } catch (e) {
    console.error("could not save the recent files list:", e);
  }
}

// Most recent first, with files that no longer exist dropped.
function list() {
  const existing = read().filter((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch (e) {
      return false;
    }
  });
  return existing.slice(0, MAX);
}

function add(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  const resolved = path.resolve(filePath);
  const current = read();
  if (current[0] === resolved) return false; // already at the top, nothing to redraw
  write([resolved, ...current.filter((p) => p !== resolved)].slice(0, MAX));
  try {
    app.addRecentDocument(resolved); // also offer it in the Dock / OS recents
  } catch (e) {
    /* not supported everywhere */
  }
  return true;
}

function clear() {
  write([]);
  try {
    app.clearRecentDocuments();
  } catch (e) {
    /* not supported everywhere */
  }
}

module.exports = { list, add, clear, remove: (p) => write(read().filter((x) => x !== path.resolve(p))) };
