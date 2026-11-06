// File > Import Sequence: a dialog that takes a pasted sequence as readily as
// a file. A sequence usually arrives in an email, an order confirmation or a
// paper's supplementary, and upstream's Import went straight to a file picker,
// so there was no way in from the clipboard.
//
// Parsing happens in the main process (ove_parseSequenceText) so that pasted
// text and opened files cannot disagree about a format: both go through
// bio-parsers, or through the tagged-text reader when the text carries tags.
(function () {
  // resolved when the dialog opens, not at load time: this file is loaded
  // before the Cloning UI toolkit it borrows
  const ui = () => window.oveCloningUI;
  const PLACEHOLDER =
    "Paste a sequence here.\n\n" +
    "Plain bases, FASTA, GenBank, SnapGene-style text, or the lab's tagged format:\n" +
    "[AviTag]ggcatgagggcggcggtggtagcgcc[/AviTag]ggtggcggtggcagc";

  const bp = (n) => `${n.toLocaleString()} bp`;
  const count = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const annotationCount = (seq) => {
    const size = (x) => (Array.isArray(x) ? x.length : x ? Object.keys(x).length : 0);
    return size(seq.features) + size(seq.primers) + size(seq.parts);
  };

  function open() {
    const UI = ui();
    if (!UI || !window.oveTabs) return;
    const { h, button, toast } = UI;

    let parsed = { sequences: [], warnings: [], format: null };
    let nameEdited = false;
    let topologyEdited = false;
    let timer = null;

    const area = h("textarea", {
      className: "bp3-input bp3-fill ove-cl-mono",
      rows: 12,
      placeholder: PLACEHOLDER,
      style: { resize: "vertical", whiteSpace: "pre", overflowWrap: "normal", overflowX: "auto" },
    });
    const nameInput = UI.textInput("", { placeholder: "Untitled Sequence", width: 260 });
    const topology = UI.select(
      [
        { value: "linear", label: "Linear" },
        { value: "circular", label: "Circular" },
      ],
      "linear",
      { width: 140 }
    );
    const summary = h("div", { className: "bp3-callout ove-cl-callout" }, "Nothing pasted yet.");
    const importBtn = button("Import", () => doImport(), { intent: "primary", icon: "import" });
    importBtn.disabled = true;

    nameInput.addEventListener("input", () => (nameEdited = true));
    topology.select.addEventListener("change", () => (topologyEdited = true));

    const setSummary = (text, intent) => {
      summary.className = `bp3-callout ove-cl-callout${intent ? ` bp3-intent-${intent}` : ""}`;
      summary.textContent = text;
    };

    // Say what was understood before anything is imported, so a half-copied
    // sequence is caught at the point of paste and not three steps later.
    async function reparse() {
      const text = area.value;
      if (!text.trim()) {
        parsed = { sequences: [], warnings: [], format: null };
        importBtn.disabled = true;
        setSummary("Nothing pasted yet.");
        return;
      }
      const res = await window.api.send("ove_parseSequenceText", {
        text,
        name: nameEdited ? nameInput.value : undefined,
      });
      parsed = res || { sequences: [], warnings: [], format: null };
      const seqs = parsed.sequences || [];
      importBtn.disabled = seqs.length === 0;

      if (!seqs.length) {
        setSummary(
          `Could not read that as a sequence${parsed.warnings.length ? `: ${parsed.warnings.join("; ")}` : "."}`,
          "danger"
        );
        return;
      }

      const first = seqs[0];
      if (!nameEdited) nameInput.value = first.name || "";
      if (!topologyEdited) topology.select.value = first.circular ? "circular" : "linear";

      const bits = [parsed.format || "sequence"];
      if (seqs.length > 1) bits.push(count(seqs.length, "sequence"));
      bits.push(bp(first.sequence.length));
      bits.push(topology.select.value);
      const annotations = annotationCount(first);
      if (annotations) bits.push(count(annotations, "annotation"));
      setSummary(
        bits.join(" · ") + (parsed.warnings.length ? ` — ${parsed.warnings.join("; ")}` : ""),
        parsed.warnings.length ? "warning" : "success"
      );
    }

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(reparse, 200);
    };
    area.addEventListener("input", schedule);
    area.addEventListener("paste", () => setTimeout(reparse, 0));

    function doImport() {
      const seqs = parsed.sequences || [];
      if (!seqs.length) return;
      const circular = topology.select.value === "circular";
      seqs.forEach((seq, i) => {
        const seqJson = Object.assign({}, seq, { circular });
        // one name field, so it names the first sequence; a multi-record paste
        // keeps the names it came with
        if (i === 0 && nameInput.value.trim()) seqJson.name = nameInput.value.trim();
        window.oveTabs.addDoc({ seqJson, activate: i === 0 });
      });
      if (parsed.warnings.length) window.oveTabs.warn("Imported", parsed.warnings);
      toast(
        seqs.length === 1
          ? `Imported ${seqs[0].name || "sequence"} (${bp(seqs[0].sequence.length)})`
          : `Imported ${count(seqs.length, "sequence")}`
      );
      dialog.close();
    }

    async function chooseFile() {
      const opened = await window.api.send("ove_openFilePicker");
      if (opened) dialog.close();
    }

    const dialog = UI.openDialog({
      title: "Import Sequence",
      width: 720,
      body: h(
        "div",
        {},
        UI.field("Paste a sequence", area),
        summary,
        UI.row(
          UI.field("Name", nameInput),
          UI.field("Topology", topology.el, "pasted bases carry no topology")
        )
      ),
      footer: h(
        "div",
        { className: "ove-cl-row", style: { width: "100%", justifyContent: "space-between" } },
        button("Choose File…", chooseFile, { icon: "folder-open" }),
        h(
          "span",
          { className: "ove-cl-row" },
          button("Cancel", () => dialog.close()),
          importBtn
        )
      ),
    });
    setTimeout(() => area.focus(), 0);
  }

  // Upstream's File > Import Sequence is the string "importSequence" in the
  // menu config; swap it for ours. Stable reference: OVE memoizes on it.
  function menuFilter(menu) {
    return menu.map((top) => {
      if (!top || top.text !== "File" || !Array.isArray(top.submenu)) return top;
      return Object.assign({}, top, {
        submenu: top.submenu.map((item) =>
          item === "importSequence"
            ? { text: "Import Sequence…", icon: "import", onClick: open }
            : item
        ),
      });
    });
  }

  window.oveImport = { open, menuFilter };
})();
