// Saved-version history, kept inside the sequence file itself.
//
// Every save appends a snapshot of what was written, so Version History has
// something to show and an older version can be recovered (#6).
//
// WHERE IT LIVES
// In the file, as one extra GenBank COMMENT line. That was a deliberate
// choice: the history then travels with the plasmid -- copied to a shared
// drive, handed to someone else, moved between machines -- instead of living
// in this Mac's application-support folder, where renaming the file would
// orphan it. The cost is that the file grows, which is why it is capped and
// why trimming and clearing are offered.
//
// HOW IT IS ENCODED
// Each snapshot is JSON, gzipped, then base64url. Several are joined with
// "." after a marker, as
//
//     OVE-HISTORY-1:<entry>.<entry>.<entry>
//
// base64url rather than plain base64 for one measured reason: a comment
// containing "=" does not survive a round trip through bio-parsers -- it
// comes back undefined, the whole comment silently gone -- and standard
// base64 ends in "=" padding most of the time. "+" and "/" are replaced as
// well, since "/" at the start of a GenBank line is the record terminator.
// "." and the base64url alphabet were checked to come back byte-identical.
//
// Only GenBank carries this. FASTA, BED and the lab's tagged text have
// nowhere to put it, so saving to those formats writes the sequence alone.
const zlib = require("zlib");

const MARKER = "OVE-HISTORY-1:";
const SEP = ".";
const DEFAULT_CAP = 25;

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

// A snapshot: when it was written, by whom, and what was written.
function encode(entry) {
  return b64url(zlib.gzipSync(Buffer.from(JSON.stringify(entry)), { level: 9 }));
}

function decode(raw) {
  try {
    const entry = JSON.parse(zlib.gunzipSync(unb64url(raw)).toString("utf8"));
    return entry && entry.data ? entry : null;
  } catch (e) {
    return null; // a truncated or hand-edited blob: ignore that entry
  }
}

// ------------------------------------------------- the comment in the file

// Separates the history blob from whatever human comments the file has.
function split(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const keep = [];
  let entries = [];
  list.forEach((c) => {
    const s = String(c);
    if (s.startsWith(MARKER)) {
      const body = s.slice(MARKER.length);
      entries = entries.concat(body ? body.split(SEP).filter(Boolean) : []);
    } else {
      keep.push(c);
    }
  });
  return { comments: keep, entries };
}

function join(comments, entries) {
  const keep = Array.isArray(comments) ? comments.slice() : [];
  if (!entries || !entries.length) return keep;
  return keep.concat([MARKER + entries.join(SEP)]);
}

// What the editor is given must never include the history: it would show up
// as a wall of base64 in the comments panel, and be saved back twice over.
function strip(sequenceData) {
  if (!sequenceData || !sequenceData.comments) return sequenceData;
  const { comments } = split(sequenceData.comments);
  return Object.assign({}, sequenceData, { comments });
}

function read(sequenceData) {
  return split(sequenceData && sequenceData.comments).entries;
}

function write(sequenceData, entries) {
  const { comments } = split(sequenceData && sequenceData.comments);
  const next = join(comments, entries);
  const out = Object.assign({}, sequenceData);
  if (next.length) out.comments = next;
  else delete out.comments;
  return out;
}

// ------------------------------------------------------------- the history

// Compared so an unchanged save does not add a second identical version --
// Save on a file you have not touched is common, and 25 copies of the same
// sequence is not a history.
function fingerprint(data) {
  return JSON.stringify(strip(data) || null);
}

function add(entries, data, { at, by, cap = DEFAULT_CAP } = {}) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (!data) return list;
  const last = list.length ? decode(list[list.length - 1]) : null;
  if (last && fingerprint(last.data) === fingerprint(data)) return list;
  list.push(
    encode({
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      at: at || new Date().toISOString(),
      by: by || "",
      data: strip(data),
    })
  );
  return cap > 0 ? list.slice(-cap) : list;
}

// The table prints dateChanged as it is given, so give it something a person
// can read rather than an ISO string. Local time, because the question being
// asked is "was this before or after I ordered the primers".
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso || "");
  const pad = (n) => String(n).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // seconds included: two saves a few seconds apart are two different
  // versions, and a table where both read "22:34" is no use for telling them
  // apart
  return (
    `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// Newest first, which is the order the version table reads best in.
function list(entries) {
  const out = [];
  (entries || []).forEach((raw) => {
    const entry = decode(raw);
    if (!entry) return;
    out.push({
      versionId: entry.id,
      dateChanged: when(entry.at),
      savedAt: entry.at,
      editedBy: entry.by || "",
    });
  });
  return out.reverse();
}

function dataAt(entries, versionId) {
  for (const raw of entries || []) {
    const entry = decode(raw);
    if (entry && entry.id === versionId) return entry.data;
  }
  return null;
}

// Keep the most recent `keep` versions. 0 clears the history.
function trim(entries, keep) {
  const list_ = Array.isArray(entries) ? entries : [];
  const n = Number(keep);
  if (!Number.isFinite(n) || n < 0) return list_.slice();
  return n === 0 ? [] : list_.slice(-n);
}

module.exports = {
  MARKER,
  when,
  DEFAULT_CAP,
  encode,
  decode,
  split,
  join,
  strip,
  read,
  write,
  add,
  list,
  dataAt,
  trim,
};
