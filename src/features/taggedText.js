// The lab's inline-tagged ("rogala") sequence format: features are marked
// inside the bases instead of in a separate coordinate table, so nothing has to
// be renumbered when the sequence is edited. That is why it is the form that
// gets pasted into notes, emails and protocols.
//
//   # name: pKR101
//   # topology: circular
//   [AviTag]ggcatgagg...[/AviTag][GS_linker]ggtggcggtggcagc[/GS_linker]...
//
// Rules, matching the lab's existing snapgene_tags.py converter:
//   * [Name] opens, [/Name] closes. Pairing is by name toggle: the first
//     sighting of a name opens it, the next one closes it, whatever slash it
//     carries. Hand-maintained files drift, so this is deliberately forgiving.
//   * A BACKSLASH ON THE OPENING TAG ([\AmpR]...[AmpR]) means the feature is on
//     the reverse strand. This is the lab's own convention, not a typo.
//   * Attributes ride on the opening tag after "|":
//     [AmpR|type=CDS|dir=rev|color=#ff0000]. Defaults: misc_feature, fwd.
//   * A spliced feature is written in numbered segments,
//     [Name#1]...[/Name#1] ... [Name#2]...[/Name#2], and rebuilds as one
//     multi-location feature.
//   * Whitespace and line breaks inside the sequence are ignored; leading
//     "# key: value" lines are a header.
//
// Nothing here touches the DOM, so it runs in the main process (File > Open,
// Save As) and under mocha alike.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof root !== "undefined" && root.document) root.oveTaggedText = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TAG_RE = /\[([^[\]]*)\]/g;
  const DEFAULT_TYPE = "misc_feature";
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const HEADER_KEYS = ["name", "topology", "created", "source"];

  // ------------------------------------------------------------------ parse

  // "Name|type=CDS|dir=rev" -> { closing, name, attrs }
  function parseTagBody(body) {
    let rest = body.trim();
    let closing = false;
    if (rest[0] === "/" || rest[0] === "\\") {
      closing = true;
      rest = rest.slice(1).trim();
    }
    const parts = rest.split("|");
    const attrs = {};
    parts.slice(1).forEach((chunk) => {
      const eq = chunk.indexOf("=");
      if (eq === -1) return;
      attrs[chunk.slice(0, eq).trim().toLowerCase()] = chunk.slice(eq + 1).trim();
    });
    return { closing, name: parts[0].trim(), attrs };
  }

  function splitHeader(text) {
    const header = {};
    const body = [];
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!body.length && trimmed.startsWith("#")) {
        const kv = trimmed.replace(/^#+/, "").trim();
        const colon = kv.indexOf(":");
        if (colon !== -1) {
          header[kv.slice(0, colon).trim().toLowerCase()] = kv.slice(colon + 1).trim();
        }
        return;
      }
      body.push(line);
    });
    return { header, body: body.join("\n") };
  }

  const strandOf = (dir) =>
    ({ rev: -1, reverse: -1, "-": -1, "-1": -1 }[String(dir || "").toLowerCase()] || 1);

  // Does this look like tagged text rather than Genbank, FASTA or raw bases?
  function looksTagged(text) {
    if (typeof text !== "string") return false;
    const head = text.slice(0, 4000);
    if (/^\s*(LOCUS|>|ORIGIN|\{)/.test(head)) return false;
    const tags = head.match(/\[[^[\]\n]{1,80}\]/g);
    if (!tags || tags.length < 2) return false;
    // at least one pair that closes, which is what separates this from, say, a
    // Genbank note that happens to contain brackets
    return /\[[\\/][^[\]\n]{1,80}\]/.test(head) || tags.length >= 4;
  }

  // text -> { sequence, features, primers, header, name, circular, warnings }
  function parseTagged(text, options) {
    const opts = options || {};
    const backslashStrand = opts.backslashStrand !== false;
    const { header, body: rawBody } = splitHeader(String(text || ""));
    const body = rawBody.replace(/\s+/g, "");

    const seq = [];
    let seqLen = 0;
    const open = new Map(); // name -> { start, attrs, slashed }
    const closed = []; // in the order they were opened
    const warnings = [];
    const revByBackslash = [];
    let pos = 0;

    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(body)) !== null) {
      seq.push(body.slice(pos, m.index));
      seqLen += m.index - pos;
      pos = m.index + m[0].length;
      const { closing, name, attrs } = parseTagBody(m[1]);
      if (!name) {
        warnings.push(`ignored an empty tag "[${m[1]}]"`);
        continue;
      }
      if (open.has(name)) {
        const entry = open.get(name);
        open.delete(name);
        const merged = Object.assign({}, entry.attrs, attrs);
        if (backslashStrand && entry.slashed && !merged.dir) {
          merged.dir = "rev";
          revByBackslash.push(name);
        }
        // start/end are 0-based inclusive, as in OVE's own annotations
        if (seqLen - 1 < entry.start) {
          warnings.push(`"${name}" closed where it opened (base ${entry.start + 1}); dropped`);
        } else {
          closed.push({ name, attrs: merged, start: entry.start, end: seqLen - 1 });
        }
      } else {
        open.set(name, { start: seqLen, attrs, slashed: closing });
      }
    }
    seq.push(body.slice(pos));
    seqLen += body.length - pos;
    const sequence = seq.join("");

    open.forEach((entry, name) => {
      warnings.push(`"${name}" opened at base ${entry.start + 1} was never closed; dropped`);
    });
    if (revByBackslash.length) {
      warnings.push(
        `put on the reverse strand because the opening tag carried a backslash: ${revByBackslash.join(", ")}`
      );
    }
    const bad = Array.from(new Set(sequence.replace(/[A-Za-z]/g, "").split(""))).sort();
    if (bad.length) warnings.push(`sequence contains non-letter characters: ${bad.join(" ")}`);

    // Name#1, Name#2, ... rebuild as one multi-location feature
    const byBase = new Map();
    const merged = [];
    closed.forEach((f) => {
      const hash = f.name.indexOf("#");
      const base = hash === -1 ? f.name : f.name.slice(0, hash);
      const numbered = hash !== -1;
      if (numbered && byBase.has(base)) {
        const target = byBase.get(base);
        target.locations.push({ start: f.start, end: f.end });
        Object.assign(target.attrs, f.attrs);
        return;
      }
      const entry = {
        name: base,
        attrs: f.attrs,
        locations: [{ start: f.start, end: f.end }],
      };
      merged.push(entry);
      if (numbered) byBase.set(base, entry);
    });

    const features = [];
    const primers = [];
    merged.forEach((entry) => {
      const a = entry.attrs;
      const locations = entry.locations.slice().sort((x, y) => x.start - y.start);
      const ann = {
        name: entry.name,
        type: a.type || DEFAULT_TYPE,
        strand: strandOf(a.dir || a.direction),
        start: locations[0].start,
        end: locations[locations.length - 1].end,
        notes: a.note ? { note: [a.note] } : {},
      };
      if (locations.length > 1) ann.locations = locations;
      if (HEX.test(a.color || "")) ann.color = a.color;
      if (ann.end > sequence.length - 1) {
        warnings.push(`"${ann.name}" runs past the end of the sequence; trimmed`);
        ann.end = sequence.length - 1;
      }
      (ann.type === "primer_bind" || ann.type === "primer" ? primers : features).push(ann);
    });

    const topology = (header.topology || "").toLowerCase();
    return {
      sequence,
      features,
      primers,
      header,
      name: header.name || "",
      circular: topology === "circular" || topology === "c",
      warnings,
    };
  }

  // A sequenceData object OVE and bio-parsers both understand.
  function taggedToSequenceData(text, options) {
    const parsed = parseTagged(text, options);
    return {
      sequenceData: {
        name: parsed.name || "Untitled Sequence",
        circular: parsed.circular,
        sequence: parsed.sequence,
        features: parsed.features,
        primers: parsed.primers,
        parts: [],
      },
      warnings: parsed.warnings,
    };
  }

  // ----------------------------------------------------------------- render

  const cleanName = (name) => String(name || "unnamed").replace(/[[\]|#]/g, "_").trim() || "unnamed";

  const isReverse = (ann) =>
    ann.strand === -1 || ann.strand === 2 || ann.forward === false;

  // seqData -> { text, warnings }.  attrs: "minimal" writes only what differs
  // from the defaults, which is what stays readable in an email; "full" writes
  // every attribute, so text -> map -> text comes back byte for byte.
  function renderTagged(seqData, options) {
    const opts = options || {};
    const attrs = opts.attrs || "minimal";
    const wrap = opts.wrap || 0;
    const typeColor = opts.typeColor || (() => undefined);
    const sequence = (seqData && seqData.sequence) || "";
    const warnings = [];

    // A live editor keeps annotations in an object keyed by id; a parsed file
    // hands them over as arrays. Accept both.
    const asList = (x) =>
      Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : [];
    const annotations = []
      .concat(asList(seqData.features))
      .concat(asList(seqData.primers).map((p) => Object.assign({}, p, { type: p.type || "primer_bind" })))
      .concat(asList(seqData.parts));

    const seen = new Map();
    const inserts = new Map(); // position -> { closers: [], openers: [] }
    const at = (pos) => {
      if (!inserts.has(pos)) inserts.set(pos, { closers: [], openers: [] });
      return inserts.get(pos);
    };

    annotations.forEach((ann) => {
      const name = cleanName(ann.name);
      if (name !== String(ann.name || "")) {
        warnings.push(`"${ann.name}" renamed to "${name}": [ ] | and # are tag syntax`);
      }
      seen.set(name, (seen.get(name) || 0) + 1);

      // origin-wrapping annotations cannot be one inline span, so they go out
      // as numbered segments, which is how the format spells a split feature
      const segments = [];
      (ann.locations && ann.locations.length ? ann.locations : [ann]).forEach((loc) => {
        if (loc.start > loc.end) {
          segments.push({ start: loc.start, end: sequence.length - 1 });
          segments.push({ start: 0, end: loc.end });
        } else {
          segments.push({ start: loc.start, end: loc.end });
        }
      });

      const multi = segments.length > 1;
      segments.forEach((seg, i) => {
        const tagName = multi ? `${name}#${i + 1}` : name;
        const bits = [];
        const type = ann.type || DEFAULT_TYPE;
        if (attrs === "full" || type !== DEFAULT_TYPE) bits.push(`type=${type}`);
        if (isReverse(ann)) bits.push("dir=rev");
        else if (attrs === "full") bits.push("dir=fwd");
        // a colour only means something when it is not just the type's colour
        const color = ann.color;
        const fromType = typeColor(type);
        const explicit =
          HEX.test(color || "") &&
          (!fromType || String(color).toUpperCase() !== String(fromType).toUpperCase());
        if (color && (attrs === "full" || explicit)) bits.push(`color=${color}`);
        const extra = bits.length ? `|${bits.join("|")}` : "";
        at(seg.start).openers.push(`[${tagName}${extra}]`);
        at(seg.end + 1).closers.push(`[/${tagName}]`);
      });
    });

    seen.forEach((count, name) => {
      if (count > 1) {
        warnings.push(
          `${count} annotations are named "${name}"; on re-import they pair by name, so overlapping ones will not come back the same`
        );
      }
    });

    const out = [];
    for (let i = 0; i <= sequence.length; i++) {
      const ins = inserts.get(i);
      if (ins) {
        // closers before openers at a shared position: [/A][B], not [B][/A]
        ins.closers.forEach((t) => out.push(t));
        ins.openers.forEach((t) => out.push(t));
      }
      if (i < sequence.length) out.push(sequence[i]);
    }
    const tagged = out.join("");

    const header = Object.assign({}, seqData.taggedHeader);
    if (seqData.name) header.name = seqData.name;
    if (seqData.circular) header.topology = "circular";
    const lines = [];
    HEADER_KEYS.forEach((k) => {
      if (header[k]) lines.push(`# ${k}: ${header[k]}`);
    });
    if (lines.length) lines.push("");
    if (wrap > 0) {
      for (let i = 0; i < tagged.length; i += wrap) lines.push(tagged.slice(i, i + wrap));
      if (!tagged.length) lines.push("");
    } else {
      lines.push(tagged);
    }
    return { text: `${lines.join("\n")}\n`, warnings };
  }

  return {
    parseTagged,
    taggedToSequenceData,
    renderTagged,
    looksTagged,
    DEFAULT_TYPE,
  };
});
