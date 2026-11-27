// The "Cloning" menu: primer design, oligo analysis, mutagenesis, restriction
// cloning, Gibson/HiFi assembly and gel simulation. Calculations live in
// dnaTools.js; this file is only UI and editor wiring.
(function () {
  const U = window.oveCloningUI;
  const D = window.dnaTools;
  const su = window.sequenceUtils;
  // reading a construct back out of primers designed elsewhere (#20)
  const F = window.oveFromPrimers;
  const PH = window.ovePrimerHybridization;
  // what the assembly will be, checked before you order anything (#42)
  const PV = window.oveProductPreview;
  const { h } = U;

  let editor = null;
  const session = []; // constructs/products made in this window, reusable as inputs
  const pickedFiles = [];

  // ------------------------------------------------------------ helpers
  // The sequence a tool works on. Normally the tab in front, but every tool
  // can be pointed somewhere else -- another open tab, a pasted sequence, a
  // file -- because the construct you are designing is not always the one you
  // happen to be looking at (#20). An overridden template brings no selection
  // or caret with it: those belong to the editor, not to the sequence.
  function current(override) {
    if (override) {
      const seqData = su.tidyUpSequenceData(override, { annotationsAsObjects: false });
      return { seqData, sel: null, caret: -1, name: seqData.name || "Untitled", overridden: true };
    }
    const st = editor.getState();
    const seqData = su.tidyUpSequenceData(st.sequenceData, { annotationsAsObjects: false });
    const layer = st.selectionLayer || {};
    const sel = layer.start > -1 && layer.end > -1 ? { start: layer.start, end: layer.end } : null;
    return { seqData, sel, caret: st.caretPosition, name: seqData.name || "Untitled" };
  }

  const plain = (seqData) => JSON.parse(JSON.stringify(seqData));
  function remember(name, seqData) {
    if (!session.some((s) => s.seqData === seqData)) session.push({ name, seqData });
  }

  async function openInNewWindow(seqData) {
    remember(seqData.name, seqData);
    await window.api.send("ove_openSequenceInNewWindow", plain(seqData));
    U.toast(`Opened "${seqData.name}" in a new tab`);
  }

  // Opening a result as a tab is not the same as keeping it. A construct you
  // have just designed usually wants to go next to the plasmids it came from,
  // under a name you choose (#20).
  async function saveSeqToFile(seqData, suggestedName) {
    const name = (suggestedName || seqData.name || "construct").replace(/[/\\]/g, "_");
    try {
      const filePath = await window.api.send("ove_showSaveDialog", {
        filters: [
          { name: "Genbank", extensions: ["gb"] },
          { name: "Fasta", extensions: ["fasta"] },
          { name: "TeselaGen JSON", extensions: ["json"] },
        ],
        title: `${name}.gb`,
        defaultPath: `~/Downloads/${name}.gb`,
        buttonLabel: "Save construct",
      });
      if (!filePath) return false; // cancelled
      await window.api.send("ove_saveFile", { filePath, sequenceDataToSave: plain(seqData) });
      U.toast(`Saved "${filePath.slice(filePath.lastIndexOf("/") + 1)}"`, "success");
      return true;
    } catch (e) {
      U.toast(`Could not save: ${e.message}`, "error");
      return false;
    }
  }

  async function pickFiles(multi = false) {
    try {
      const seqs = ((await window.api.send("ove_pickSequenceFiles", { multi })) || []).map((s) => su.tidyUpSequenceData(s, { annotationsAsObjects: false }));
      seqs.forEach((s) => pickedFiles.push({ name: s.name, seqData: s }));
      return seqs;
    } catch (e) {
      U.toast(`Could not open file: ${e.message}`, "error");
      return [];
    }
  }

  // all sequences the user can pick as inputs
  // Everything a tool can be pointed at: the tab in front, the other tabs
  // open in this window, anything built here this session, and any file
  // opened from a picker (#20). Other tabs matter most -- an assembly's
  // fragments are usually already open, which is why they were opened.
  function otherTabs() {
    const tabs = (window.oveTabs && window.oveTabs.docs) || [];
    const active = window.oveTabs && window.oveTabs.getActive();
    return tabs
      .filter((d) => d !== active)
      .map((d) => {
        // a tab that is not in front has no live editor; its snapshot is kept
        const sd = d.editor ? d.editor.getState().sequenceData : d.seqJson;
        return sd && sd.sequence ? { name: `${d.name} (tab)`, seqData: su.tidyUpSequenceData(sd, { annotationsAsObjects: false }) } : null;
      })
      .filter(Boolean);
  }

  function availableSequences() {
    const { seqData, name } = current();
    return [
      { name: `${name} (current tab)`, seqData },
      ...otherTabs(),
      ...session.map((s) => ({ name: `${s.name} (made this session)`, seqData: s.seqData })),
      ...pickedFiles.map((f) => ({ name: `${f.name} (file)`, seqData: f.seqData })),
    ];
  }

  function conditionsEditor(initial = D.DEFAULT_CONDITIONS) {
    const na = U.numberInput(initial.Na, { step: 5, min: 0, width: 70 });
    const mg = U.numberInput(initial.Mg, { step: 0.1, min: 0, width: 70 });
    const dntp = U.numberInput(initial.dNTPs, { step: 0.1, min: 0, width: 70 });
    const conc = U.numberInput(initial.primerNM, { step: 50, min: 1, width: 80 });
    const el = h(
      "details",
      { className: "ove-cl-details" },
      h("summary", {}, "Reaction conditions for Tm (SantaLucia 1998 nearest-neighbour + Owczarzy 2008 salt correction)"),
      U.row(U.field("Na⁺/K⁺ (mM)", na), U.field("Mg²⁺ (mM)", mg), U.field("dNTPs total (mM)", dntp), U.field("Primer (nM)", conc))
    );
    return { el, get: () => ({ Na: +na.value, Mg: +mg.value, dNTPs: +dntp.value, primerNM: +conc.value }) };
  }

  // enzyme name input with autocomplete (common cloning enzymes first, with site counts)
  let enzymeListId = null;
  function enzymeInput(value = "", seqData) {
    enzymeListId = `ove-cl-enz-${Math.random().toString(36).slice(2)}`;
    const counts = (name) => {
      try {
        return seqData ? D.cutPositions(seqData, [name]).length : null;
      } catch (e) {
        return null;
      }
    };
    const list = h(
      "datalist",
      { id: enzymeListId },
      D.COMMON_ENZYMES.map((n) => {
        const c = counts(n);
        return h("option", { value: n, label: c === null ? "" : `${c} site${c === 1 ? "" : "s"}` });
      })
    );
    const input = h("input", { className: "bp3-input bp3-small", type: "text", value, placeholder: "e.g. EcoRI", style: { width: "110px" } });
    input.setAttribute("list", enzymeListId);
    return { el: h("span", {}, input, list), input };
  }
  const enzymeNames = (...inputs) => inputs.map((i) => i.value.trim()).filter(Boolean);
  const checkEnzymes = (names) => names.forEach((n) => D.getEnzyme(n));

  const oneBased = (i) => i + 1;
  const describeEnd = (e) => (!e ? "–" : e.type === "end" ? "sequence end" : e.type === "blunt" ? `blunt (${e.enzyme})` : `${e.type} ${e.seq} (${e.enzyme})`);

  function addPrimersToCurrent(primers) {
    const st = editor.getState();
    const sd = st.sequenceData;
    const n = sd.sequence.length;
    const add = {};
    primers.forEach((p) => {
      const id = `ovecl${Math.random().toString(36).slice(2, 10)}`;
      add[id] = {
        id,
        name: p.name,
        start: ((p.start % n) + n) % n,
        end: ((p.end % n) + n) % n,
        forward: p.forward,
        strand: p.forward ? 1 : -1,
        type: "primer_bind",
        notes: { note: [`5'-${p.seq}-3'`, ...(p.note ? [p.note] : [])] },
      };
    });
    editor.updateEditor({ sequenceData: { ...sd, primers: { ...(sd.primers || {}), ...add } } });
    U.toast(`Added ${primers.length} primer${primers.length === 1 ? "" : "s"} to the sequence`);
  }

  const primersTsv = (primers) => primers.map((p) => `${p.name}\t${p.seq}\t${p.seq.length} nt`).join("\n");

  function wrapTry(fn) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        console.error(e);
        U.toast(e.message, "error");
      }
    };
  }

  // ------------------------------------------------------- primer design
  function tailEditor(label, seqData) {
    const mode = U.select(["None", "Restriction site", "Custom sequence"], "None", { width: 150 });
    const enz = enzymeInput("", seqData);
    const leader = U.textInput(D.DEFAULT_LEADER, { width: 70, mono: true });
    const custom = U.textInput("", { width: 180, mono: true, placeholder: "5′ tail, e.g. GCCACC" });
    const enzWrap = U.row(U.field("Enzyme", enz.el), U.field("Extra 5′ bases", leader, "helps the enzyme cut near the end"));
    const customWrap = U.row(U.field("Tail (5′→3′)", custom));
    const refresh = () => {
      enzWrap.style.display = mode.select.value === "Restriction site" ? "" : "none";
      customWrap.style.display = mode.select.value === "Custom sequence" ? "" : "none";
    };
    mode.select.addEventListener("change", refresh);
    refresh();
    return {
      el: h("div", {}, U.field(label, mode.el), enzWrap, customWrap),
      get: () => {
        if (mode.select.value === "Restriction site") {
          const e = D.getEnzyme(enz.input.value.trim());
          return D.clean(leader.value) + e.site.toUpperCase();
        }
        if (mode.select.value === "Custom sequence") return D.clean(custom.value);
        return "";
      },
    };
  }

  function openPrimerDesigner({ template } = {}) {
    const { seqData, sel, name } = current(template);
    const n = seqData.sequence.length;
    const from = U.numberInput(sel ? oneBased(sel.start) : 1, { min: 1, max: n, width: 90 });
    const to = U.numberInput(sel ? oneBased(sel.end) : Math.min(n, 1000), { min: 1, max: n, width: 90 });
    const nameIn = U.textInput(`${name}`.replace(/\s+/g, "_").slice(0, 20), { width: 140 });
    const tmT = U.numberInput(60, { step: 0.5 });
    const tmMin = U.numberInput(55, { step: 0.5 });
    const tmMax = U.numberInput(65, { step: 0.5 });
    const lenMin = U.numberInput(18, { min: 12, max: 40 });
    const lenMax = U.numberInput(30, { min: 12, max: 45 });
    const flank = U.numberInput(0, { min: 0, max: 500, width: 80 });
    const cond = conditionsEditor();
    const fTail = tailEditor("Forward primer 5′ addition", seqData);
    const rTail = tailEditor("Reverse primer 5′ addition", seqData);
    const results = h("div");
    const productBox = h("div");
    let pairs = [];
    let chosen = null;
    let tails = { f: "", r: "" };

    const primerRecords = (pair) => {
      const base = nameIn.value.trim() || "P";
      const f = pair.forward;
      const r = pair.reverse;
      return [
        { name: `${base}_F`, seq: tails.f.toLowerCase() + f.seq, start: f.pos, end: f.pos + f.length - 1, forward: true, note: `Tm ${U.fmt(f.tm)} °C (annealing part)` },
        { name: `${base}_R`, seq: tails.r.toLowerCase() + r.seq, start: r.pos - r.length + 1, end: r.pos, forward: false, note: `Tm ${U.fmt(r.tm)} °C (annealing part)` },
      ];
    };

    const design = wrapTry(() => {
      const region = { start: +from.value - 1, end: +to.value - 1 };
      if (!seqData.circular && region.end < region.start) throw new Error("'To' must be after 'From' for a linear sequence");
      tails = { f: fTail.get(), r: rTail.get() };
      pairs = D.designPrimers(seqData.sequence, seqData.circular, region, {
        targetTm: +tmT.value, minTm: +tmMin.value, maxTm: +tmMax.value, minLen: +lenMin.value, maxLen: +lenMax.value, flank: +flank.value, conditions: cond.get(),
      });
      chosen = pairs[0] || null;
      results.innerHTML = "";
      if (!pairs.length) {
        // explain the most common cause: ambiguous bases where primers must bind
        const maxLen = +lenMax.value;
        const near = (pos, strand) =>
          strand === 1
            ? D.circSlice(seqData.sequence, pos - +flank.value, pos + maxLen, seqData.circular)
            : D.circSlice(seqData.sequence, pos - maxLen + 1, pos + 1 + +flank.value, seqData.circular);
        const ambiguous = [
          /[^ACGT]/i.test(near(region.start, 1)) ? "the start" : null,
          /[^ACGT]/i.test(near(region.end, -1)) ? "the end" : null,
        ].filter(Boolean);
        results.appendChild(
          U.callout(
            ambiguous.length
              ? `No primers found: there are ambiguous bases (N etc.) at ${ambiguous.join(" and ")} of the region, where primers need to bind. Move the region, or allow primers outside it.`
              : "No primers found. Try widening the Tm or length range, or allowing primers outside the region.",
            "warning"
          )
        );
        return;
      }
      results.appendChild(
        U.table(
          [
            { title: "#", render: (_, i) => i + 1 },
            { title: "Forward 5′→3′", render: (p) => U.primerSpan(tails.f, p.forward.seq) },
            { title: "Tm", render: (p) => U.fmt(p.forward.tm) },
            { title: "Reverse 5′→3′", render: (p) => U.primerSpan(tails.r, p.reverse.seq) },
            { title: "Tm", render: (p) => U.fmt(p.reverse.tm) },
            { title: "GC% F/R", render: (p) => `${U.fmt(p.forward.gc, 0)}/${U.fmt(p.reverse.gc, 0)}` },
            { title: "Product", render: (p) => `${p.productSize + tails.f.length + tails.r.length} bp` },
            { title: "Ta Taq / HiFi", render: (p) => `${p.annealing.taq} / ${p.annealing.hifi} °C` },
            {
              title: "Checks",
              render: (p) =>
                U.warnList([
                  ...p.forward.warnings.map((w) => `F: ${w}`),
                  ...p.reverse.warnings.map((w) => `R: ${w}`),
                  ...(p.heteroDimer.dG < -6 ? [`F/R dimer ΔG ${U.fmt(p.heteroDimer.dG)} kcal/mol${p.heteroDimer.involves3p ? " at 3′ end" : ""}`] : []),
                ]),
            },
          ],
          pairs,
          { onSelect: (p) => { chosen = p; showProduct(); }, selectedIndex: 0 }
        ),
        U.callout(
          "Tm is for the annealing part only (tails in lowercase orange). Ta: Taq ≈ lower Tm − 5 °C; Q5/Phusion ≈ lower Tm + 3 °C (max 72). Hover ⚠ for details. Click a row to choose it.",
          "none"
        )
      );
      showProduct();
    });

    const showProduct = () => {
      productBox.innerHTML = "";
      if (!chosen) return;
      productBox.appendChild(U.section("Product", pcrProductView({ seqData, pair: chosen, tails, name })));
    };

    const needChosen = () => {
      if (!chosen) throw new Error("Design primers and choose a pair first");
      return chosen;
    };
    const footer = [
      U.button("Design primers", design, { intent: "primary", icon: "search" }),
      U.button("Add to sequence", wrapTry(() => addPrimersToCurrent(primerRecords(needChosen()))), { icon: "add" }),
      U.button("Copy primers", wrapTry(() => U.copyText(primersTsv(primerRecords(needChosen())), "Primers copied")), { icon: "clipboard" }),
      U.button(
        "Open PCR product",
        wrapTry(() => {
          const p = needChosen();
          const amp = D.sliceSeqData(seqData, p.productStart, p.productEnd + 1);
          const product = D.concatSeqData([{ sequence: tails.f }, amp, { sequence: D.revcomp(tails.r) }], {
            name: `${nameIn.value.trim() || "PCR"}_product`,
            circular: false,
          });
          openInNewWindow(product);
        }),
        { icon: "document-open" }
      ),
      U.button(
        "Save PCR product…",
        wrapTry(() => {
          const p = needChosen();
          const amp = D.sliceSeqData(seqData, p.productStart, p.productEnd + 1);
          const product = D.concatSeqData([{ sequence: tails.f }, amp, { sequence: D.revcomp(tails.r) }], {
            name: `${nameIn.value.trim() || "PCR"}_product`,
            circular: false,
          });
          saveSeqToFile(product);
        }),
        { icon: "floppy-disk" }
      ),
    ];

    U.openDialog({
      title: "Design PCR Primers",
      width: 900,
      body: [
        templatePicker("Template", "primers", template),
        U.callout(sel ? `Region from your selection (${oneBased(sel.start)}–${oneBased(sel.end)}).` : "Tip: select a region in the sequence before opening this tool to fill in From/To.", "primary"),
        U.section("Region to amplify", U.row(U.field("From", from), U.field("To", to), U.field("Allow primers outside region (bp)", flank, "0 = primers start exactly at the ends (for cloning)"), U.field("Primer name prefix", nameIn))),
        U.section("Primer rules", U.row(U.field("Target Tm °C", tmT), U.field("Min Tm", tmMin), U.field("Max Tm", tmMax), U.field("Min length", lenMin), U.field("Max length", lenMax)), cond.el),
        U.section("5′ additions (restriction sites, Kozak, tags…)", U.row(fTail.el, rTail.el)),
        results,
        productBox,
      ],
      footer,
    });
  }

  // ------------------------------------------------------ oligo analyzer
  // Binding sites come from features/primerHybridization.js. The rule this
  // replaced aligned the whole oligo and allowed two mismatches across its
  // full length, which rejected every primer with a 5' tail — exactly the
  // primers this app is used for. Kept as a thin shim because it was a public
  // window.oveCloning entry point.
  function findBindingSites(template, circular, oligoIn, maxMismatches) {
    const params = Object.assign({}, window.ovePrimerView.defaults());
    if (maxMismatches === 0) params.allowIsolatedMismatch = false;
    const r = window.ovePrimerHybridization.findSites(template, oligoIn, {
      isCircular: circular,
      params,
    });
    return r.sites.map((site) => ({
      start: site.start,
      end: site.end,
      strand: site.bottomStrand ? -1 : 1,
      mismatches: site.mismatchCount,
      site,
    }));
  }

  const activeDocKey = () => {
    const doc = window.oveTabs && window.oveTabs.getActive();
    return (doc && doc.id) || "default";
  };

  function openOligoAnalyzer({ template } = {}) {
    const { seqData, sel } = current(template);
    const selSeq = sel ? D.circSlice(seqData.sequence, sel.start, sel.end >= sel.start ? sel.end + 1 : sel.end + 1 + seqData.sequence.length, seqData.circular) : "";
    const o2 = U.textArea("", { placeholder: "Oligo 2 (optional), 5′→3′ – for primer-pair checks", rows: 2 });
    const cond = conditionsEditor();
    const out = h("div");

    // read the sequence live rather than from the snapshot this dialog opened
    // with: it stays open while the sequence is edited behind it
    const live = () => {
      const doc = window.oveTabs && window.oveTabs.getActive();
      return (doc && doc.editor && doc.editor.getState().sequenceData) || seqData;
    };
    const view = window.ovePrimerView.create({
      bases: selSeq.length <= 80 ? selSeq.toUpperCase() : "",
      template: () => live().sequence,
      isCircular: () => !!live().circular,
      docKey: activeDocKey(),
      placeholder: "Oligo 1 — primer bases, 5′→3′ (a 5′ tail is fine)",
      rows: 2,
      buttons: [
        {
          text: "Annotate this site",
          icon: "add",
          title: "Write the shown binding site onto the sequence as a primer",
          onClick: (site, bases) => {
            if (!site) return U.toast("No binding site to annotate", "warning");
            addPrimersToCurrent([
              {
                name: `oligo${site.mismatchCount ? `_${site.mismatchCount}mm` : ""}`,
                seq: bases,
                start: site.start,
                end: site.end,
                forward: !site.bottomStrand,
                note: site.tailLength ? `${site.tailLength} nt 5′ tail` : null,
              },
            ]);
          },
        },
      ],
      onChange: () => {
        // the oligo cards below are about the bases, so they go stale the
        // moment the bases change
        out.innerHTML = "";
      },
    });
    const kv = (pairs) => h("dl", { className: "ove-cl-kv" }, pairs.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
    const oligoCard = (title, a) =>
      U.section(
        title,
        kv([
          ["Length", `${a.length} nt`],
          ["Tm", `${U.fmt(a.tm)} °C`],
          ["GC", `${U.fmt(a.gc)} %`],
          ["MW", `${U.fmt(a.mw, 0)} g/mol`],
          ["Hairpin", a.hairpin.dG < 0 ? `ΔG ${U.fmt(a.hairpin.dG)} kcal/mol (${a.hairpin.stem} bp stem)` : "none found"],
          ["Self-dimer", a.selfDimer.dG < 0 ? `ΔG ${U.fmt(a.selfDimer.dG)} kcal/mol (${a.selfDimer.length} bp${a.selfDimer.involves3p ? ", 3′ end" : ""})` : "none found"],
          ["Checks", a.warnings.length ? h("span", { className: "ove-cl-warn" }, a.warnings.join("; ")) : h("span", { className: "ove-cl-ok" }, "looks good")],
        ])
      );

    const analyze = wrapTry(() => {
      out.innerHTML = "";
      const seqs = [view.getBases(), o2.value].map(D.clean).filter((s) => s.length >= 2);
      if (!seqs.length) throw new Error("Enter at least one oligo sequence");
      const analyses = seqs.map((s) => D.analyzeOligo(s, cond.get()));
      analyses.forEach((a, i) => out.appendChild(oligoCard(`Oligo ${i + 1}`, a)));
      if (analyses.length === 2) {
        const dimer = D.bestDimer(seqs[0], seqs[1]);
        const ta = D.annealingTemps(analyses[0].tm, analyses[1].tm);
        out.appendChild(
          U.section(
            "Primer pair",
            kv([
              ["ΔTm", `${U.fmt(Math.abs(analyses[0].tm - analyses[1].tm))} °C ${Math.abs(analyses[0].tm - analyses[1].tm) > 3 ? "(aim for ≤ 3 °C)" : ""}`],
              ["Cross-dimer", dimer.dG < 0 ? `ΔG ${U.fmt(dimer.dG)} kcal/mol (${dimer.length} bp${dimer.involves3p ? ", 3′ end" : ""})` : "none found"],
              ["Annealing temp", `Taq ≈ ${ta.taq} °C · Q5/Phusion ≈ ${ta.hifi} °C`],
            ])
          )
        );
      }
    });

    U.openDialog({
      title: "Primer / Oligo Analyzer",
      width: 760,
      body: [
        templatePicker("Sequence to search", "oligo", template),
        U.section("Oligo 1 — where it binds on this sequence", view.el),
        U.section("Oligo 2 (optional)", o2),
        cond.el,
        out,
      ],
      footer: [U.button("Analyze Tm, hairpins and dimers", analyze, { intent: "primary", icon: "calculator" })],
    });
  }

  // ---------------------------------------------------------- mutagenesis
  const AA3 = { A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", Q: "Gln", E: "Glu", G: "Gly", H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val", "*": "Stop" };
  const AA_FROM_3 = Object.fromEntries(Object.entries(AA3).map(([k, v]) => [v.toUpperCase(), k]));

  function cdsFeatures(seqData) {
    return (seqData.features || []).filter((f) => /cds|gene|orf/i.test(f.type || "")).sort((a, b) => a.start - b.start);
  }

  function codonInfo(seqData, feature, residue) {
    const seq = seqData.sequence.toUpperCase();
    const n = seq.length;
    const offset = 3 * (residue - 1);
    let start, codon;
    if (feature.forward !== false && feature.strand !== -1) {
      start = feature.start + offset;
      codon = D.circSlice(seq, start, start + 3, true);
    } else {
      const codonEnd = feature.end - offset; // 3' end of codon on the top strand = first base of codon on bottom
      start = codonEnd - 2;
      codon = D.revcomp(D.circSlice(seq, start, codonEnd + 1, true));
    }
    return { start: ((start % n) + n) % n, codon, aa: D.CODON_TABLE[codon] || "?", reverse: !(feature.forward !== false && feature.strand !== -1) };
  }

  function openMutagenesis({ template } = {}) {
    const { seqData, sel, name } = current(template);
    const n = seqData.sequence.length;
    const cds = cdsFeatures(seqData);
    const HAVE_PRIMERS = "I already have the primers";
    const mode = U.select(
      [
        ...(cds.length ? ["Change an amino acid"] : []),
        "Change bases (substitute / delete / insert)",
        HAVE_PRIMERS,
      ],
      cds.length ? "Change an amino acid" : undefined,
      { width: 290 }
    );
    // amino-acid mode
    const featSel = U.select(cds.map((f, i) => ({ value: String(i), label: `${f.name} (${oneBased(f.start)}–${oneBased(f.end)}, ${f.forward === false ? "←" : "→"})` })), "0", { width: 290 });
    const residue = U.numberInput(1, { min: 1, width: 80 });
    const newAA = U.textInput("", { width: 70, placeholder: "e.g. A" });
    const host = U.select([{ value: "human", label: "Human / mammalian" }, { value: "ecoli", label: "E. coli" }], "human", { width: 170 });
    const aaInfo = h("div", { className: "ove-cl-hint", style: { marginBottom: "8px" } });
    const aaWrap = h("div", {}, U.row(U.field("Coding feature", featSel.el), U.field("Residue #", residue), U.field("New amino acid", newAA, "1- or 3-letter, * = stop"), U.field("Codon preference (ties)", host.el)), aaInfo);
    // bases mode
    const from = U.numberInput(sel ? oneBased(sel.start) : 1, { min: 1, max: n, width: 90 });
    const to = U.numberInput(sel ? oneBased(sel.end) : 1, { min: 1, max: n, width: 90 });
    const newBases = U.textInput("", { width: 260, mono: true, placeholder: "leave empty to delete" });
    const insertOnly = U.checkbox("Insert after 'To' (don't replace anything)", false);
    const baseWrap = h("div", {}, U.row(U.field("From", from), U.field("To", to), U.field("New bases (top strand, 5′→3′)", newBases)), insertOnly.el);
    const method = U.select(
      [
        { value: "q5", label: "Non-overlapping primers (NEB Q5 SDM / KLD)" },
        { value: "quikchange", label: "Overlapping primers (QuikChange)" },
      ],
      "q5",
      { width: 310 }
    );
    const tmT = U.numberInput(60, { step: 0.5 });
    const out = h("div");
    let result = null;

    // ---- the pair you already ordered, rather than one designed here (#20)
    const pastedF = U.textArea("", { placeholder: "Forward primer, 5′→3′", rows: 2 });
    const pastedR = U.textArea("", { placeholder: "Reverse primer, 5′→3′", rows: 2 });
    const pastedOut = h("div");
    let pasted = null;
    // Declared here, filled in just before the dialog opens: refresh() runs
    // during setup, before the buttons exist, and a const would be in its
    // temporal dead zone at that point.
    let designButtons = [];
    let pastedButtons = [];
    const haveWrap = h(
      "div",
      {},
      h(
        "div",
        { className: "ove-cl-hint", style: { marginBottom: "6px" } },
        "Paste the pair you ordered. Where they sit, what they change and the mutant they make are all read off the primers and this template — nothing is restated by hand."
      ),
      U.row(U.field("Forward", pastedF), U.field("Reverse", pastedR)),
      pastedOut
    );

    function buildPastedMutant() {
      if (!pasted || !pasted.ok) throw new Error("Check the primers first");
      const len = pasted.sequence.length;
      const toMutant = (templatePos1) => {
        const i = (templatePos1 - 1 - (pasted.offset || 0) + len * 2) % len;
        return i;
      };
      const features = (pasted.edits || []).map((e) => ({
        name: `${e.from}${e.position}${e.to}`,
        type: "misc_difference",
        start: toMutant(e.position),
        end: toMutant(e.position),
        forward: true,
        notes: { note: [`${e.from} → ${e.to} at ${e.position} of ${name}`] },
      }));
      const fwdLen = pasted.forward.primer.length;
      const revLen = pasted.reverse.primer.length;
      const primers =
        pasted.layout === "back-to-back"
          ? [
              { name: "pasted_F", start: 0, end: fwdLen - 1, forward: true, type: "primer_bind" },
              { name: "pasted_R", start: len - revLen, end: len - 1, forward: false, type: "primer_bind" },
            ]
          : [];
      return su.tidyUpSequenceData(
        {
          name: `${name}_mut`,
          sequence: pasted.sequence,
          circular: !!seqData.circular,
          features,
          primers,
        },
        { annotationsAsObjects: false }
      );
    }

    const checkPasted = wrapTry(() => {
      pasted = F.mutagenesis({
        sequence: seqData.sequence,
        isCircular: !!seqData.circular,
        forward: pastedF.value,
        reverse: pastedR.value,
      });
      pastedOut.innerHTML = "";
      const res = pasted;
      // the verdict first, as the hybridisation panel does
      res.problems.forEach((msg) =>
        pastedOut.appendChild(U.callout(msg, res.ok ? "warning" : "danger"))
      );
      if (res.forward && res.forward.ok) {
        pastedOut.appendChild(
          U.callout(`Forward primer: ${PH.describe(res.forward.site)}`, "none")
        );
      }
      if (res.reverse && res.reverse.ok) {
        pastedOut.appendChild(
          U.callout(`Reverse primer: ${PH.describe(res.reverse.site)}`, "none")
        );
      }
      if (!res.ok) return;
      pastedOut.appendChild(
        U.callout(
          `${res.layout === "overlapping" ? "Overlapping pair (QuikChange)" : "Back-to-back pair (Q5 / KLD)"}: ` +
            `${res.edits.length ? `${res.edits.length} base change${res.edits.length > 1 ? "s" : ""}` : "no base change"}` +
            `${res.lengthChange ? `, ${res.lengthChange > 0 ? "+" : ""}${res.lengthChange} bp` : ""}.`,
          res.edits.length || res.lengthChange ? "primary" : "warning"
        )
      );
      if (res.edits.length) {
        pastedOut.appendChild(
          U.table(
            [
              { title: "Position (on this template)", render: (e) => e.position },
              { title: "Template", render: (e) => e.from },
              { title: "Primer", render: (e) => e.to },
            ],
            res.edits
          )
        );
      }
    });

    const refresh = () => {
      const haveMode = mode.select.value === HAVE_PRIMERS;
      const aaMode = !haveMode && mode.select.value.startsWith("Change an amino");
      aaWrap.style.display = aaMode ? "" : "none";
      baseWrap.style.display = !haveMode && !aaMode ? "" : "none";
      haveWrap.style.display = haveMode ? "" : "none";
      designButtons.forEach((b) => (b.style.display = haveMode ? "none" : ""));
      pastedButtons.forEach((b) => (b.style.display = haveMode ? "" : "none"));
      if (aaMode && cds.length) {
        try {
          const f = cds[+featSel.select.value];
          const info = codonInfo(seqData, f, +residue.value);
          const target = parseAA(newAA.value);
          const newCodon = target ? D.chooseCodon(info.codon, target, host.select.value) : null;
          aaInfo.textContent = `Residue ${residue.value}: ${info.codon} (${AA3[info.aa] || info.aa}) at bases ${oneBased(info.start)}–${oneBased(info.start + 2)}${newCodon ? ` → ${newCodon} (${AA3[target]}), ${[...newCodon].filter((c, i) => c !== info.codon[i]).length} base change(s)` : ""}`;
        } catch (e) {
          aaInfo.textContent = e.message;
        }
      }
    };
    [mode.select, featSel.select, host.select].forEach((s) => s.addEventListener("change", refresh));
    [residue, newAA].forEach((i) => i.addEventListener("input", refresh));
    refresh();

    function parseAA(v) {
      const s = v.trim().toUpperCase();
      if (!s) return null;
      if (s.length === 1 && AA3[s]) return s;
      if (s === "STOP") return "*";
      if (AA_FROM_3[s]) return AA_FROM_3[s];
      throw new Error(`Unknown amino acid "${v}"`);
    }

    const design = wrapTry(() => {
      let start, end, bases, label;
      if (mode.select.value.startsWith("Change an amino")) {
        const f = cds[+featSel.select.value];
        const info = codonInfo(seqData, f, +residue.value);
        const target = parseAA(newAA.value);
        if (!target) throw new Error("Enter the new amino acid");
        const newCodon = D.chooseCodon(info.codon, target, host.select.value);
        start = info.start;
        end = info.start + 2;
        bases = info.reverse ? D.revcomp(newCodon) : newCodon;
        label = `${info.aa}${residue.value}${target === "*" ? "stop" : target}`;
      } else {
        bases = D.clean(newBases.value);
        if (insertOnly.input.checked) {
          start = +to.value; // insert after 1-based position `to`
          end = start - 1;
          if (!bases) throw new Error("Enter the bases to insert");
          label = `ins${bases.length}bp_${to.value}`;
        } else {
          start = +from.value - 1;
          end = +to.value - 1;
          if (end < start) throw new Error("'To' must not be before 'From'");
          label = bases ? `${from.value}-${to.value}to${bases.length <= 6 ? bases : `${bases.length}bp`}` : `del${from.value}-${to.value}`;
        }
      }
      const res = D.designMutagenesis(seqData.sequence, seqData.circular, { start, end, newBases: bases }, { method: method.select.value, targetTm: +tmT.value });
      const prefix = `${name}`.replace(/\s+/g, "_").slice(0, 16);
      res.primers.forEach((p) => (p.name = `${prefix}_${label}_${p.name.split("_").pop()}`));
      result = { ...res, start, end, bases, label };
      out.innerHTML = "";
      out.appendChild(
        U.table(
          [
            { title: "Primer", render: (p) => p.name },
            { title: "Sequence 5′→3′", render: (p) => h("span", { className: "ove-cl-mono" }, p.seq) },
            { title: "Length", render: (p) => `${p.seq.length}` },
            { title: "Tm", render: (p) => h("span", { title: p.tmNote }, `${U.fmt(p.tm)} °C`) },
            { title: "Checks", render: (p) => U.warnList(D.analyzeOligo(p.seq).warnings.filter((w) => !/GC/.test(w))) },
          ],
          res.primers
        ),
        U.callout(
          method.select.value === "q5"
            ? "Non-overlapping design: primers anneal back-to-back; amplify the whole plasmid, then treat with KLD (kinase–ligase–DpnI). Annealing temp: use the lower Tm + 3 °C for Q5."
            : "Overlapping design: complementary primers with the mutation in the middle; amplify with a high-fidelity polymerase, then DpnI-digest. Tm by the Agilent formula (aim ≥ 78 °C).",
          "none"
        )
      );
    });

    // Built the same way whether it is going into a tab or into a file (#20).
    function buildMutant() {
      if (!result) throw new Error("Design primers first");
      let mutant = D.mutateSeqData(seqData, { start: result.start, end: result.end, newBases: result.bases });
      mutant = { ...mutant, name: `${name}_${result.label}`, circular: seqData.circular };
      const m = mutant.sequence.toUpperCase();
      const doubled = m + m;
      const primers = [];
      result.primers.forEach((p, i) => {
        const probe = i === 0 ? p.seq.toUpperCase() : D.revcomp(p.seq).toUpperCase();
        const pos = doubled.indexOf(probe);
        if (pos >= 0)
          primers.push({
            name: p.name,
            start: pos % m.length,
            end: (pos + probe.length - 1) % m.length,
            forward: i === 0,
            type: "primer_bind",
            notes: { note: [`5'-${p.seq}-3'`] },
          });
      });
      mutant.primers = [...(mutant.primers || []), ...primers];
      if (result.bases.length || result.end >= result.start) {
        mutant.features = [
          ...(mutant.features || []),
          {
            name: `mutation ${result.label}`,
            type: "misc_difference",
            start: result.start,
            end: Math.max(result.start, result.start + Math.max(result.bases.length, 1) - 1),
            forward: true,
          },
        ];
      }
      return su.tidyUpSequenceData(mutant, { annotationsAsObjects: false });
    }

    // Two sets, one shown at a time: designing a pair here, or checking the
    // pair you already have (#20).
    designButtons = [
      U.button("Design primers", design, { intent: "primary", icon: "search" }),
      U.button(
        "Copy primers",
        wrapTry(() => {
          if (!result) throw new Error("Design primers first");
          U.copyText(primersTsv(result.primers), "Primers copied");
        }),
        { icon: "clipboard" }
      ),
      U.button("Open mutant plasmid", wrapTry(() => openInNewWindow(buildMutant())), {
        icon: "document-open",
      }),
      U.button("Save mutant…", wrapTry(() => saveSeqToFile(buildMutant())), { icon: "floppy-disk" }),
    ];
    pastedButtons = [
      U.button("Check these primers", checkPasted, { intent: "primary", icon: "search" }),
      U.button("Open mutant plasmid", wrapTry(() => openInNewWindow(buildPastedMutant())), {
        icon: "document-open",
      }),
      U.button("Save mutant…", wrapTry(() => saveSeqToFile(buildPastedMutant())), {
        icon: "floppy-disk",
      }),
    ];

    refresh();

    U.openDialog({
      title: "Site-Directed Mutagenesis",
      width: 820,
      body: [
        templatePicker("Template", "mutagenesis", template),
        U.section("What to change", U.field("Mode", mode.el), h("div", { style: { height: "8px" } }), aaWrap, baseWrap, haveWrap),
        U.section("Primer design", U.row(U.field("Method", method.el), U.field("Target Tm °C", tmT))),
        out,
      ],
      footer: [...designButtons, ...pastedButtons],
    });
  }

  // --------------------------------------------------- restriction cloning
  // ------------------------------------------- what the assembly will be (#42)
  // The product, its joins, and whether each join holds. Shared by both Gibson
  // modes: designing the overlaps here, and reading them off primers that
  // already exist. `joins` are productPreview junctions with a Tm added.
  function junctionView(joins, { minOverlap = 15 } = {}) {
    const box = h("div");
    PV.problems(joins, { minOverlap }).forEach((p) =>
      box.appendChild(U.callout(p.text, p.level))
    );
    box.appendChild(
      U.table(
        [
          { title: "Junction", render: (j) => `${j.after} → ${j.before}` },
          { title: "Overlap", render: (j) => `${j.length} nt` },
          { title: "Tm", render: (j) => (typeof j.tm === "number" ? `${U.fmt(j.tm)} °C` : "–") },
          { title: "GC", render: (j) => `${Math.round(j.gc)}%` },
          {
            title: "Unique",
            render: (j) =>
              j.occurrences === 1
                ? "yes"
                : h("span", { className: "ove-cl-warn", title: "This overlap occurs more than once, so the pieces can join in the wrong order" }, `${j.occurrences}×`),
          },
          {
            title: "Across the junction (overlap in colour)",
            render: (j) =>
              j.before5 === undefined
                ? U.primerSpan("", j.overlap)
                : h(
                    "span",
                    { className: "ove-cl-seq" },
                    h("span", { className: "ove-cl-flank" }, j.before5),
                    U.primerSpan("", j.overlap),
                    h("span", { className: "ove-cl-flank" }, j.after3)
                  ),
          },
        ],
        joins
      )
    );
    return box;
  }

  // What the PCR will actually give you: the product's ends, and whether the
  // pair can prime anywhere else on this template (extra bands).
  function pcrProductView({ seqData, pair, tails, name }) {
    const box = h("div");
    const n = seqData.sequence.length;
    const amp = D.circSlice(seqData.sequence, pair.productStart, pair.productEnd + 1, seqData.circular);
    const total = amp.length + tails.f.length + tails.r.length;
    const parts = [
      tails.f.length ? `${tails.f.length} nt 5\u2032 addition` : null,
      `${amp.length} bp of ${name} (${oneBased(pair.productStart)}\u2013${oneBased(pair.productEnd)})`,
      tails.r.length ? `${tails.r.length} nt 5\u2032 addition` : null,
    ].filter(Boolean);
    box.appendChild(U.callout(`${total} bp linear product: ${parts.join(" + ")}.`, "success"));

    const flank = 15;
    const ends = [
      { end: "5\u2032", tail: tails.f, body: amp.slice(0, flank), tailFirst: true },
      { end: "3\u2032", tail: D.revcomp(tails.r), body: amp.slice(-flank), tailFirst: false },
    ];
    box.appendChild(
      U.table(
        [
          { title: "End of the product", render: (e) => e.end },
          {
            title: "Sequence (5\u2032 addition in colour)",
            render: (e) =>
              h(
                "span",
                { className: "ove-cl-seq" },
                e.tailFirst ? U.primerSpan("", e.tail) : h("span", { className: "ove-cl-flank" }, e.body),
                e.tailFirst ? h("span", { className: "ove-cl-flank" }, e.body) : U.primerSpan("", e.tail)
              ),
          },
        ],
        ends
      )
    );

    // Extra bands: either primer binding a second time is the usual cause.
    let sites;
    try {
      sites = {
        f: findBindingSites(seqData.sequence, seqData.circular, tails.f + pair.forward.seq, 1),
        r: findBindingSites(seqData.sequence, seqData.circular, tails.r + pair.reverse.seq, 1),
      };
    } catch (e) {
      return box; // the preview is worth having even if the search fails
    }
    const products = PV.pcrProducts({
      forwardSites: sites.f.filter((s) => s.strand === 1),
      reverseSites: sites.r.filter((s) => s.strand === -1),
      templateLength: n,
      circular: !!seqData.circular,
    });
    const expected = products.find((p) => p.start === pair.productStart && p.end === pair.productEnd);
    const extras = products.filter((p) => p !== expected);
    if (!expected || !extras.length) {
      box.appendChild(
        h("div", { className: "ove-cl-hint" }, `Each primer binds ${sites.f.length === 1 && sites.r.length === 1 ? "once" : `${sites.f.length}\u00d7 / ${sites.r.length}\u00d7`} on this template, giving one product.`)
      );
      return box;
    }
    box.appendChild(
      U.callout(
        `This pair can also prime elsewhere on ${name}: ${extras
          .map((p) => `${p.size} bp (${oneBased(p.start)}\u2013${oneBased(p.end)}${p.mismatches ? `, ${p.mismatches} mismatch${p.mismatches > 1 ? "es" : ""}` : ", exact"})`)
          .join(", ")}. Expect extra bands \u2014 move a primer, or gel-purify the ${expected.size} bp band.`,
        "warning"
      )
    );
    return box;
  }

  // A ligation junction has no Tm or uniqueness question -- what you want to
  // see is the scar: which two ends met, and the sequence they made.
  function ligationView(joins) {
    return U.table(
      [
        { title: "Junction", render: (j) => `${j.after} \u2192 ${j.before}` },
        { title: "Ends", render: (j) => (j.enzymes.length ? j.enzymes.join(" + ") : "\u2013") },
        { title: "Overhang", render: (j) => (j.blunt ? "blunt" : `${j.overhang.length} nt ${j.overhang}`) },
        {
          title: "Across the junction (overhang in colour)",
          render: (j) =>
            h(
              "span",
              { className: "ove-cl-seq" },
              h("span", { className: "ove-cl-flank" }, j.before5),
              U.primerSpan("", j.overhang),
              h("span", { className: "ove-cl-flank" }, j.after3)
            ),
        },
      ],
      joins
    );
  }

  // How often each enzyme still cuts the product: 0 means the site was lost,
  // 2 means you can cut the insert back out.
  function recutLine(seqData, names) {
    if (!names.length) return null;
    const cuts = D.cutPositions(seqData, names);
    const text = names
      .map((n) => {
        const enz = D.getEnzyme(n);
        const count = cuts.filter((c) => c.enzyme === enz.name).length;
        return `${enz.name} ${count}\u00d7`;
      })
      .join(", ");
    return h("div", { className: "ove-cl-hint" }, `Sites left in the product: ${text}.`);
  }

  // Each piece's Tm, worked out from the overlap the junction actually has.
  function withTms(joins) {
    return joins.map((j) => ({ ...j, tm: j.overlap ? D.tm(j.overlap) : null }));
  }

  function productSummary({ pieces, sequence, circular }) {
    const s = PV.summary({ pieces, sequence, circular });
    const order = s.pieces.map((r) => `${r.name} (${r.length} bp)`).join(" → ");
    return U.callout(
      `${s.length} bp ${s.circular ? "circular" : "linear"} product: ${order}${s.circular ? ` → ${s.pieces[0].name}` : ""}.`,
      "success"
    );
  }

  function fragmentTable(frags, onSelect, selectedIndex, seqLength) {
    const wrap = (i) => (seqLength ? ((i % seqLength) + seqLength) % seqLength : i);
    return U.table(
      [
        { title: "Fragment", render: (f) => `${f.size} bp` },
        { title: "Position", render: (f) => (f.uncut ? "uncut" : `${oneBased(wrap(f.start))}–${oneBased(wrap(f.end - 1))}`) },
        { title: "Left end", render: (f) => describeEnd(f.left) },
        { title: "Right end", render: (f) => describeEnd(f.right) },
      ],
      frags,
      { onSelect, selectedIndex }
    );
  }

  // The template a tool runs on, changeable from inside the tool: any open
  // tab, a pasted sequence, or a file (#20). Changing it reopens the dialog
  // on the new template -- everything in a cloning dialog is derived from the
  // sequence, so there is nothing worth carrying across.
  function templatePicker(label, toolName, chosen) {
    const opts = availableSequences();
    const names = opts.map((o) => `${o.name}, ${o.seqData.sequence.length} bp`);
    const currentName = chosen ? `${chosen.name || "Untitled"} (chosen)` : names[0];
    const sel = U.select(
      [...(chosen ? [{ value: "-1", label: currentName }] : []), ...names.map((label2, i) => ({ value: String(i), label: label2 }))],
      chosen ? "-1" : "0",
      { width: 320 }
    );
    sel.select.addEventListener("change", () => {
      const i = +sel.select.value;
      if (i >= 0) reopenWith(toolName, opts[i].seqData);
    });
    return U.row(
      U.field(label, sel.el),
      U.button(
        "Open file…",
        async () => {
          const [sd] = await pickFiles(false);
          if (sd) reopenWith(toolName, sd);
        },
        { icon: "folder-open" }
      ),
      U.button("Paste…", () => pasteSequence((sd) => reopenWith(toolName, sd)), { icon: "clipboard" })
    );
  }

  // Paste a sequence in, wherever one is wanted (#20).
  function pasteSequence(onPick, { circular = true, name = "pasted_template" } = {}) {
    const ta = U.textArea("", { placeholder: "Paste DNA sequence (FASTA or plain)", rows: 6 });
    const nm = U.textInput(name, { width: 200 });
    const circ = U.checkbox("Circular", circular);
    const d = U.openDialog({
      title: "Paste a sequence",
      width: 560,
      body: [U.row(U.field("Name", nm), circ.el), ta],
      footer: [
        U.button(
          "Use sequence",
          () => {
            const seq = D.clean(ta.value.replace(/^>.*$/gm, ""));
            if (seq.length < 10) return U.toast("Sequence is too short", "error");
            const sd = su.tidyUpSequenceData(
              { name: nm.value || name, sequence: seq, circular: circ.input.checked },
              { annotationsAsObjects: false }
            );
            pickedFiles.push({ name: sd.name, seqData: sd });
            d.close();
            onPick(sd);
          },
          { intent: "primary" }
        ),
      ],
    });
  }

  function reopenWith(toolName, seqData) {
    U.closeAllDialogs && U.closeAllDialogs();
    const fn = TOOLS[toolName];
    if (fn) wrapTry(() => fn({ template: seqData }))();
  }

  function sequencePicker(label, onPick, { allowPaste = true } = {}) {
    const holder = h("div");
    const render = () => {
      holder.innerHTML = "";
      const opts = availableSequences().slice(1); // exclude the current window (it's the vector)
      const sel = U.select([{ value: "", label: opts.length ? "— choose —" : "— open a file or paste —" }, ...opts.map((o, i) => ({ value: String(i), label: `${o.name}, ${o.seqData.sequence.length} bp` }))], "", { width: 300 });
      sel.select.addEventListener("change", () => sel.select.value && onPick(opts[+sel.select.value].seqData));
      holder.appendChild(
        U.row(
          U.field(label, sel.el),
          U.button("Open file…", async () => {
            const [s] = await pickFiles(false);
            if (s) {
              render();
              onPick(s);
            }
          }, { icon: "folder-open" }),
          allowPaste
            ? U.button("Paste sequence…", () => {
                const ta = U.textArea("", { placeholder: "Paste DNA sequence (FASTA or plain)", rows: 5 });
                const nm = U.textInput("pasted_insert", { width: 180 });
                const circ = U.checkbox("Circular", false);
                const d = U.openDialog({
                  title: "Paste sequence",
                  width: 560,
                  body: [U.row(U.field("Name", nm), circ.el), ta],
                  footer: [
                    U.button("Use sequence", () => {
                      const raw = ta.value.replace(/^>.*$/gm, "");
                      const seq = D.clean(raw);
                      if (seq.length < 10) return U.toast("Sequence is too short", "error");
                      const sd = su.tidyUpSequenceData({ name: nm.value || "pasted", sequence: seq, circular: circ.input.checked }, { annotationsAsObjects: false });
                      pickedFiles.push({ name: sd.name, seqData: sd });
                      d.close();
                      render();
                      onPick(sd);
                    }, { intent: "primary" }),
                  ],
                });
              }, { icon: "clipboard" })
            : null
        )
      );
    };
    render();
    return holder;
  }

  function openRestrictionCloning({ template } = {}) {
    const { seqData: vector, name } = current(template);
    const vE1 = enzymeInput("", vector);
    const vE2 = enzymeInput("", vector);
    const iE1 = enzymeInput("");
    const iE2 = enzymeInput("");
    const vFragsBox = h("div");
    const insertBox = h("div");
    const iFragsBox = h("div");
    const out = h("div");
    const productName = U.textInput(`${name}_clone`, { width: 220 });
    let insert = null;
    let vFrag = null;
    let iFrag = null;
    let lastInsertFrags = [];
    const endsVerdict = (way) =>
      way.fits
        ? "both ends fit"
        : !way.left && !way.right
        ? "neither end fits"
        : way.left
        ? `left end fits, right end (${describeEnd(way.rightEnd)}) does not`
        : `right end fits, left end (${describeEnd(way.leftEnd)}) does not`;

    const digestVector = wrapTry(() => {
      const names = enzymeNames(vE1.input, vE2.input);
      vFragsBox.innerHTML = "";
      if (!names.length) return;
      checkEnzymes(names);
      const frags = D.digest(vector, names);
      const biggest = frags.reduce((a, b) => (a.size > b.size ? a : b));
      vFrag = biggest;
      vFragsBox.appendChild(fragmentTable(frags, (f) => (vFrag = f), frags.indexOf(biggest), vector.sequence.length));
      if (!iE1.input.value && !iE2.input.value) {
        iE1.input.value = vE1.input.value;
        iE2.input.value = vE2.input.value;
        digestInsert();
      }
    });
    const digestInsert = wrapTry(() => {
      iFragsBox.innerHTML = "";
      if (!insert) return;
      const names = enzymeNames(iE1.input, iE2.input);
      if (!names.length) {
        // uncut linear insert (e.g. blunt PCR product)
        const frag = { index: 0, start: 0, end: insert.sequence.length, size: insert.sequence.length, left: { type: "blunt", seq: "", enzyme: "PCR end" }, right: { type: "blunt", seq: "", enzyme: "PCR end" } };
        iFrag = frag;
        lastInsertFrags = [frag];
        iFragsBox.appendChild(fragmentTable([frag], (f) => (iFrag = f), 0));
        return;
      }
      checkEnzymes(names);
      const frags = D.digest(insert, names);
      // default: the fragment with enzyme cuts on both ends, else the largest
      const internal = frags.filter((f) => f.left && f.right && f.left.type !== "end" && f.right.type !== "end");
      const pick = (internal.length ? internal : frags).reduce((a, b) => (a.size > b.size ? a : b));
      iFrag = pick;
      lastInsertFrags = frags;
      iFragsBox.appendChild(fragmentTable(frags, (f) => (iFrag = f), frags.indexOf(pick), insert.sequence.length));
    });
    [vE1, vE2].forEach((e) => e.input.addEventListener("change", digestVector));
    [iE1, iE2].forEach((e) => e.input.addEventListener("change", digestInsert));

    const picker = sequencePicker("Insert source", (s) => {
      insert = s;
      insertBox.textContent = `Insert: ${s.name} — ${s.sequence.length} bp, ${s.circular ? "circular" : "linear"}`;
      digestInsert();
    });

    const ligate = wrapTry(() => {
      out.innerHTML = "";
      if (!vFrag) throw new Error("Choose vector enzymes and a vector fragment");
      if (!insert || !iFrag) throw new Error("Choose an insert and an insert fragment");
      const res = D.restrictionClone({ vector, vectorFragment: vFrag, insert, insertFragment: iFrag, name: productName.value || "clone" });
      if (res.vectorSelfLigates) out.appendChild(U.callout("The vector's two ends are compatible with each other, so it can re-close without an insert: dephosphorylate the vector (e.g. rSAP/CIP) and screen colonies.", "warning"));
      if (!res.products.length) {
        out.appendChild(
          U.callout(
            `These ends can't be ligated. Vector ends: ${describeEnd(vFrag.left)} … ${describeEnd(vFrag.right)}. Insert ends: ${describeEnd(iFrag.left)} … ${describeEnd(iFrag.right)}. Compatible ends need the same overhang type and sequence (or both blunt).`,
            "danger"
          )
        );
        // a dead end is not an answer: say whether any other fragment of this
        // insert would close the circle, and which way round
        const report = D.insertFits({ vector, vectorFragment: vFrag, insert, fragments: lastInsertFrags });
        const fitting = report.filter((r) => r.fits);
        if (fitting.length) {
          out.appendChild(
            U.callout(
              `${fitting
                .map((r) => {
                  const way = r.ways.find((w) => w.fits);
                  return `the ${r.fragment.size} bp fragment${way.flip ? ", reversed," : ""} would close it`;
                })
                .join("; ")}. Choose it in the Insert table above.`,
              "primary"
            )
          );
        } else {
          out.appendChild(
            U.table(
              [
                { title: "Insert fragment", render: (r) => `${r.fragment.size} bp` },
                { title: "As cut", render: (r) => endsVerdict(r.ways[0]) },
                { title: "Reversed", render: (r) => endsVerdict(r.ways[1]) },
              ],
              report
            )
          );
        }
        return;
      }
      if (res.products.length === 2) out.appendChild(U.callout("The insert can go in both orientations (non-directional cloning) — screen colonies for the one you want.", "warning"));
      out.appendChild(
        U.table(
          [
            { title: "Product", render: (p) => p.sequenceData.name },
            { title: "Insert orientation", render: (p) => p.orientation },
            { title: "Size", render: (p) => `${p.sequenceData.sequence.length} bp` },
            {
              title: "",
              render: (p) => {
                const named = () =>
                  `${productName.value || "clone"}${res.products.length > 1 ? `_${p.orientation}` : ""}`;
                return h(
                  "div",
                  { style: { display: "flex", gap: "4px" } },
                  U.button("Open", () => openInNewWindow({ ...p.sequenceData, name: named() }), {
                    intent: "primary",
                    icon: "document-open",
                  }),
                  U.button("Save…", () => saveSeqToFile(p.sequenceData, named()), { icon: "floppy-disk" })
                );
              },
            },
          ],
          res.products
        )
      );
      const names = [...new Set([...enzymeNames(vE1.input, vE2.input), ...enzymeNames(iE1.input, iE2.input)])];
      res.products.forEach((p) => {
        const seq = p.sequenceData.sequence;
        let at = 0;
        const previewPieces = (p.pieces || []).map((pc) => {
          const piece = { name: pc.name, sequence: seq.slice(at, at + pc.length) };
          at += pc.length;
          return piece;
        });
        if (!previewPieces.length) return;
        out.appendChild(productSummary({ pieces: previewPieces, sequence: seq, circular: true }));
        out.appendChild(ligationView(PV.ligationJoins({ pieces: p.pieces, joins: p.joins, sequence: seq, circular: true })));
        const recut = recutLine(p.sequenceData, names);
        if (recut) out.appendChild(recut);
      });
    });

    U.openDialog({
      title: "Restriction Cloning (digest + ligate)",
      width: 860,
      body: [
        templatePicker("Vector", "restriction", template),
        U.section(`Vector: ${name} (${vector.sequence.length} bp, ${vector.circular ? "circular" : "linear"})`, U.row(U.field("Enzyme 1", vE1.el), U.field("Enzyme 2 (optional)", vE2.el)), vFragsBox),
        U.section("Insert", picker, h("div", { className: "ove-cl-hint", style: { marginBottom: "6px" } }, insertBox), U.row(U.field("Enzyme 1", iE1.el), U.field("Enzyme 2 (optional)", iE2.el, "leave both empty for a blunt, uncut PCR product")), iFragsBox),
        U.section("Product", U.row(U.field("Name", productName)), out),
      ],
      footer: [U.button("Ligate", ligate, { intent: "primary", icon: "link" })],
    });
  }

  // --------------------------------------------------------- Gibson / HiFi
  function openGibson({ template } = {}) {
    const { seqData: vector, sel, caret, name } = current(template);
    const n = vector.sequence.length;
    const linMode = U.select(
      [
        { value: "enzymes", label: "Cut with restriction enzyme(s)" },
        { value: "selection", label: sel ? `PCR-amplify, replacing selection ${oneBased(sel.start)}–${oneBased(sel.end)}` : "PCR-amplify, replacing a selection (select one first)" },
        { value: "caret", label: caret > -1 ? `PCR-amplify, opening at the cursor (after base ${caret})` : "PCR-amplify, opening at the cursor (click in the sequence first)" },
      ],
      "enzymes",
      { width: 360 }
    );
    const e1 = enzymeInput("", vector);
    const e2 = enzymeInput("", vector);
    const enzWrap = U.row(U.field("Enzyme 1", e1.el), U.field("Enzyme 2 (optional)", e2.el, "largest fragment is used as the backbone"));
    linMode.select.addEventListener("change", () => (enzWrap.style.display = linMode.select.value === "enzymes" ? "" : "none"));
    const overlap = U.numberInput(20, { min: 12, max: 60 });
    const tmT = U.numberInput(60, { step: 0.5 });
    const constructName = U.textInput(`${name}_assembly`, { width: 220 });
    const inserts = [];
    const listBox = h("div");
    const out = h("div");
    let result = null;

    const renderList = () => {
      listBox.innerHTML = "";
      if (!inserts.length) {
        listBox.appendChild(h("div", { className: "ove-cl-hint" }, "No inserts yet — add them in the order they should appear after the vector."));
        return;
      }
      listBox.appendChild(
        U.table(
          [
            { title: "#", render: (_, i) => i + 1 },
            { title: "Insert", render: (x) => x.seqData.name },
            { title: "Size", render: (x) => `${x.seqData.sequence.length} bp` },
            {
              title: "Reverse",
              render: (x) => {
                const c = U.checkbox("", x.reverse);
                c.input.addEventListener("change", () => (x.reverse = c.input.checked));
                return c.el;
              },
            },
            {
              title: "",
              render: (x, i) =>
                h(
                  "span",
                  {},
                  U.button("", () => {
                    if (i > 0) [inserts[i - 1], inserts[i]] = [inserts[i], inserts[i - 1]];
                    renderList();
                  }, { minimal: true, icon: "arrow-up", title: "Move up" }),
                  U.button("", () => {
                    if (i < inserts.length - 1) [inserts[i + 1], inserts[i]] = [inserts[i], inserts[i + 1]];
                    renderList();
                  }, { minimal: true, icon: "arrow-down", title: "Move down" }),
                  U.button("", () => {
                    inserts.splice(i, 1);
                    renderList();
                  }, { minimal: true, icon: "trash", title: "Remove" })
                ),
            },
          ],
          inserts
        )
      );
    };
    renderList();
    const picker = sequencePicker("Add insert", (s) => {
      inserts.push({ seqData: s, reverse: false });
      renderList();
    });

    // ------------------------------------------------- primers you already have
    // One slot per fragment, each with its own template: a NEBuilder run is
    // two primers per fragment against two to four different plasmids, and
    // which template a pair belongs to is the one thing the primers cannot
    // tell us (#20).
    const slots = [];
    const slotsBox = h("div");
    const pastedOut = h("div");
    let pastedResult = null;

    function slotPicker(slot) {
      const opts = availableSequences();
      const sel = U.select(
        [
          { value: "", label: slot.seqData ? `${slot.seqData.name}, ${slot.seqData.sequence.length} bp` : "— choose a template —" },
          ...opts.map((o, i) => ({ value: String(i), label: `${o.name}, ${o.seqData.sequence.length} bp` })),
        ],
        "",
        { width: 260 }
      );
      sel.select.addEventListener("change", () => {
        if (sel.select.value === "") return;
        slot.seqData = opts[+sel.select.value].seqData;
        renderSlots();
      });
      return sel.el;
    }

    function renderSlots() {
      slotsBox.innerHTML = "";
      if (!slots.length) {
        slotsBox.appendChild(
          h("div", { className: "ove-cl-hint" }, "No fragments yet — add one per PCR you are running.")
        );
        return;
      }
      slots.forEach((slot, i) => {
        slotsBox.appendChild(
          U.section(
            `Fragment ${i + 1}${slot.seqData ? ` — ${slot.seqData.name}` : ""}`,
            U.row(
              U.field("Template", slotPicker(slot)),
              U.button("Open file…", async () => {
                const [sd] = await pickFiles(false);
                if (sd) {
                  slot.seqData = sd;
                  renderSlots();
                }
              }, { icon: "folder-open" }),
              U.button("Paste…", () => pasteSequence((sd) => {
                slot.seqData = sd;
                renderSlots();
              }), { icon: "clipboard" }),
              U.button("Remove", () => {
                slots.splice(i, 1);
                renderSlots();
              }, { icon: "trash", minimal: true })
            ),
            U.row(U.field("Forward primer", slot.fwd), U.field("Reverse primer", slot.rev))
          )
        );
      });
    }

    function addSlot(seqData) {
      slots.push({
        seqData: seqData || null,
        fwd: U.textArea("", { placeholder: "Forward primer, 5′→3′ (tail + annealing)", rows: 2 }),
        rev: U.textArea("", { placeholder: "Reverse primer, 5′→3′ (tail + annealing)", rows: 2 }),
      });
      renderSlots();
    }
    addSlot(vector);
    addSlot(null);

    const checkPasted = wrapTry(() => {
      pastedOut.innerHTML = "";
      pastedResult = F.gibson({
        circular: true,
        minOverlap: +overlap.value || 15,
        fragments: slots.map((slot, i) => ({
          name: slot.seqData ? slot.seqData.name : `Fragment ${i + 1}`,
          sequence: slot.seqData ? slot.seqData.sequence : "",
          isCircular: slot.seqData ? !!slot.seqData.circular : false,
          forward: slot.fwd.value,
          reverse: slot.rev.value,
        })),
      });
      const res = pastedResult;
      res.problems.forEach((msg) =>
        pastedOut.appendChild(U.callout(msg, res.ok ? "warning" : "danger"))
      );
      if (!res.ok) {
        if (!res.problems.length) pastedOut.appendChild(U.callout("Could not read these primers.", "danger"));
        return;
      }
      pastedOut.appendChild(
        U.callout(
          `Assembles as ${res.order.join(" → ")} → ${res.order[0]}: ${res.sequence.length} bp circular construct.`,
          "success"
        )
      );
      // The piece boundaries are not known here -- the primers decide them --
      // so each junction is located by its own overlap instead.
      const pastedJoins = withTms(
        res.junctions.map((j) => {
          const where = PV.contextOf(res.sequence, j.overlap, { circular: true });
          return {
            ...j,
            gc: PV.gc(j.overlap),
            occurrences: PV.occurrences(res.sequence, j.overlap, true),
            ...(where || {}),
          };
        })
      );
      pastedOut.appendChild(junctionView(pastedJoins, { minOverlap: +overlap.value || 15 }));
    });

    function buildPastedConstruct() {
      if (!pastedResult || !pastedResult.ok) throw new Error("Check the primers first");
      return su.tidyUpSequenceData(
        {
          name: constructName.value || "assembly",
          sequence: pastedResult.sequence,
          circular: true,
        },
        { annotationsAsObjects: false }
      );
    }

    const haveWrap = h(
      "div",
      {},
      h(
        "div",
        { className: "ove-cl-hint", style: { marginBottom: "6px" } },
        "One slot per PCR. The 3′ ends say what each pair amplifies and the 5′ tails say what joins to what, so the order of the assembly is read off the primers rather than asked for."
      ),
      slotsBox,
      U.row(U.button("Add fragment", () => addSlot(null), { icon: "add" })),
      pastedOut
    );

    function vectorPiece() {
      const mode = linMode.select.value;
      if (mode === "enzymes") {
        const names = enzymeNames(e1.input, e2.input);
        if (!names.length) throw new Error("Enter at least one enzyme to linearize the vector");
        checkEnzymes(names);
        const frags = D.digest(vector, names);
        if (frags[0].uncut) throw new Error("The enzyme(s) don't cut this vector");
        const backbone = frags.reduce((a, b) => (a.size > b.size ? a : b));
        // double-stranded part only; single-stranded overhangs are chewed back by the exonuclease
        return { piece: D.sliceSeqData(vector, backbone.left.hi, backbone.right.lo), primers: false, note: `${backbone.left.enzyme}…${backbone.right.enzyme} backbone` };
      }
      if (mode === "selection") {
        if (!sel) throw new Error("Select the region to replace first");
        const start = sel.end + 1;
        const end = sel.start > sel.end ? sel.start : sel.start + n;
        return { piece: D.sliceSeqData(vector, start, end), primers: true, note: "PCR-amplified vector" };
      }
      if (caret < 0) throw new Error("Click in the sequence to place the cursor first");
      return { piece: D.sliceSeqData(vector, caret, caret + n), primers: true, note: "PCR-amplified vector" };
    }

    const design = wrapTry(() => {
      if (!inserts.length) throw new Error("Add at least one insert");
      const v = vectorPiece();
      const pieces = [{ seqData: { ...v.piece, name: `${name}_vector` } }, ...inserts.map((x) => ({ seqData: x.seqData, reverse: x.reverse }))];
      result = D.designGibson(pieces, { overlap: +overlap.value, targetTm: +tmT.value, circular: true, vectorHasPrimers: v.primers, name: constructName.value || "assembly" });
      const rows = [];
      result.pieces.forEach((p, i) => p.primers.forEach((pr) => rows.push({ piece: i === 0 ? `Vector (${v.note})` : p.name, ...pr })));
      out.innerHTML = "";
      if (!v.primers) out.appendChild(U.callout(`Vector: ${v.note}, no primers needed. Overlaps (${overlap.value} bp) are added to the insert primers.`, "none"));
      out.appendChild(
        U.table(
          [
            { title: "Piece", render: (r) => r.piece },
            { title: "Primer", render: (r) => r.name },
            { title: "Sequence 5′→3′ (overlap lowercase)", render: (r) => U.primerSpan(r.seq.replace(/[ACGTN]+$/, ""), r.seq.replace(/^[acgtn]+/, "")) },
            { title: "Anneal Tm", render: (r) => `${U.fmt(r.tm)} °C` },
            {
              title: "Overlap Tm",
              render: (r) => (r.overlapTm === null ? "–" : r.overlapTm < 48 ? h("span", { className: "ove-cl-warn", title: "Aim for ≥ 48–50 °C; lengthen the overlap" }, `${U.fmt(r.overlapTm)} °C`) : `${U.fmt(r.overlapTm)} °C`),
            },
            { title: "Length", render: (r) => r.seq.length },
          ],
          rows
        ),
        U.callout(`NEBuilder HiFi: 15–20 bp overlaps for 2–3 fragments; Gibson: 20–40 bp. PCR the inserts with these primers, then assemble.`, "none")
      );
      // The product, piece by piece, with every join checked (#42). Lengths
      // come from the inputs and the sequence from the construct, so the
      // preview describes what was actually built rather than re-deriving it.
      let at = 0;
      const previewPieces = pieces.map((piece, i) => {
        const len = piece.seqData.sequence.length;
        const seq = result.construct.sequence.slice(at, at + len);
        at += len;
        return { name: i === 0 ? `${name}_vector` : piece.seqData.name, sequence: seq };
      });
      const joins = withTms(
        PV.junctions({
          pieces: previewPieces,
          sequence: result.construct.sequence,
          overlap: +overlap.value || 20,
          circular: true,
        })
      );
      out.appendChild(
        U.section(
          "Product",
          productSummary({ pieces: previewPieces, sequence: result.construct.sequence, circular: true }),
          junctionView(joins, { minOverlap: +overlap.value || 15 })
        )
      );
    });

    // Designing the overlaps here, or reading them off primers that already
    // exist (#20). The settings and the construct name serve both.
    const DESIGN = "Design the overlaps here";
    const HAVE = "I already have the primers";
    const gMode = U.select([DESIGN, HAVE], DESIGN, { width: 290 });
    const designWrap = h(
      "div",
      {},
      U.section(`Vector: ${name} (${n} bp)`, U.field("Linearize by", linMode.el), h("div", { style: { height: "6px" } }), enzWrap),
      U.section("Inserts (in order)", picker, listBox)
    );
    const designButtons = [
      U.button("Design assembly", design, { intent: "primary", icon: "build" }),
      U.button("Copy primers", wrapTry(() => {
        if (!result) throw new Error("Design the assembly first");
        U.copyText(primersTsv(result.pieces.flatMap((p) => p.primers)), "Primers copied");
      }), { icon: "clipboard" }),
      U.button("Open assembled construct", wrapTry(() => {
        if (!result) throw new Error("Design the assembly first");
        openInNewWindow({ ...result.construct, name: constructName.value || "assembly" });
      }), { icon: "document-open" }),
      U.button("Save construct…", wrapTry(() => {
        if (!result) throw new Error("Design the assembly first");
        saveSeqToFile(result.construct, constructName.value || "assembly");
      }), { icon: "floppy-disk" }),
    ];
    const pastedButtons = [
      U.button("Check these primers", checkPasted, { intent: "primary", icon: "search" }),
      U.button("Open assembled construct", wrapTry(() => openInNewWindow(buildPastedConstruct())), {
        icon: "document-open",
      }),
      U.button("Save construct…", wrapTry(() => saveSeqToFile(buildPastedConstruct())), {
        icon: "floppy-disk",
      }),
    ];
    const gRefresh = () => {
      const have = gMode.select.value === HAVE;
      designWrap.style.display = have ? "none" : "";
      haveWrap.style.display = have ? "" : "none";
      out.style.display = have ? "none" : "";
      designButtons.forEach((b) => (b.style.display = have ? "none" : ""));
      pastedButtons.forEach((b) => (b.style.display = have ? "" : "none"));
    };
    gMode.select.addEventListener("change", gRefresh);
    gRefresh();

    U.openDialog({
      title: "Gibson / NEBuilder HiFi Assembly",
      width: 900,
      body: [
        templatePicker("Vector / backbone", "gibson", template),
        U.field("Mode", gMode.el),
        designWrap,
        haveWrap,
        U.section("Settings", U.row(U.field("Overlap (bp)", overlap), U.field("Target annealing Tm °C", tmT), U.field("Construct name", constructName))),
        out,
      ],
      footer: [...designButtons, ...pastedButtons],
    });
  }

  // ---------------------------------------------------------------- gel
  // ------------------------------------------------------- codon usage
  // The classic 4x4x4 codon table, one species at a time, with each amino
  // acid's commonest codon in green. Read-only on purpose: it answers "what
  // does this host prefer" without pulling a whole optimizer into the app.
  const BASES = ["T", "C", "A", "G"];
  const AA_NAMES = {
    A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", Q: "Gln", E: "Glu", G: "Gly",
    H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser",
    T: "Thr", W: "Trp", Y: "Tyr", V: "Val", "*": "Stop",
  };

  function codonGrid(species) {
    const CU = window.oveCodonUsage;
    const best = CU.favourites(species.codons, D.CODON_TABLE);
    const cell = (first, second) =>
      h(
        "td",
        { className: "ove-cl-codon-cell" },
        BASES.map((third) => {
          const codon = first + second + third;
          const aa = D.CODON_TABLE[codon];
          const freq = species.codons[codon];
          return h(
            "div",
            { className: ["ove-cl-codon", best[codon] && "ove-cl-codon-best"].filter(Boolean).join(" ") },
            h("span", { className: "ove-cl-codon-seq" }, codon),
            h("span", { className: "ove-cl-codon-aa" }, aa === "*" ? "Stop (*)" : `${AA_NAMES[aa]} (${aa})`),
            h("span", { className: "ove-cl-codon-freq" }, freq.toFixed(2))
          );
        })
      );
    return h(
      "table",
      { className: "ove-cl-codon-table" },
      h("thead", null, h("tr", null, h("th", null, ""), ...BASES.map((b) => h("th", null, b)), h("th", null, ""))),
      h(
        "tbody",
        null,
        BASES.map((first) =>
          h(
            "tr",
            null,
            h("th", null, first),
            ...BASES.map((second) => cell(first, second)),
            h("th", { className: "ove-cl-codon-third" }, BASES.join(" "))
          )
        )
      )
    );
  }

  function codonTsv(species) {
    const CU = window.oveCodonUsage;
    const best = CU.favourites(species.codons, D.CODON_TABLE);
    const rows = Object.keys(species.codons)
      .sort()
      .map((c) => [c, D.CODON_TABLE[c], species.codons[c].toFixed(2), best[c] ? "most used" : ""].join("\t"));
    return ["codon\tamino acid\tfraction\tnote", ...rows].join("\n");
  }

  function openCodonTable() {
    const CU = window.oveCodonUsage;
    const picker = U.select(CU.SPECIES.map((s) => ({ value: s.id, label: s.label })), "human", { width: 320 });
    const box = h("div");
    const draw = () => {
      box.innerHTML = "";
      box.appendChild(codonGrid(CU.byId(picker.select.value)));
    };
    picker.select.addEventListener("change", draw);
    draw();
    U.openDialog({
      title: "Codon Usage Table",
      width: 980,
      body: [
        U.row(U.field("Species", picker.el)),
        box,
        U.callout(
          "Fractions are per amino acid \u2014 the six Leu codons add up to 1, not the whole table. Green is the commonest codon for that amino acid. Counted genome-wide over GenBank coding sequences (Kazusa), so it is an average, not a guide to any one gene.",
          "none"
        ),
      ],
      footer: [
        U.button("Copy table", () => U.copyText(codonTsv(CU.byId(picker.select.value)), "Codon table copied"), { icon: "clipboard" }),
      ],
    });
  }

  // --------------------------------------------------- sanger clone check
  // The app could already align reads and draw their traces. What it could
  // not do was answer the question: is this colony the construct I designed?
  // src/alignment/cloneCheck.js turns the alignment into that answer.
  function openCloneCheck({ template } = {}) {
    const CC = window.oveCloneCheck;
    const AL = window.oveLocalAligner;
    const { seqData: construct, name } = current(template);
    const reads = [];
    const readsBox = h("div");
    const out = h("div");

    const renderReads = () => {
      readsBox.innerHTML = "";
      if (!reads.length) {
        readsBox.appendChild(h("div", { className: "ove-cl-hint" }, "No reads yet \u2014 add the .ab1 traces (or their sequences) from this colony."));
        return;
      }
      readsBox.appendChild(
        U.table(
          [
            { title: "Read", render: (r) => r.name },
            { title: "Bases", render: (r) => `${r.seqData.sequence.length}` },
            {
              title: "",
              render: (r) =>
                U.button("Remove", () => {
                  reads.splice(reads.indexOf(r), 1);
                  renderReads();
                }, { icon: "cross" }),
            },
          ],
          reads
        )
      );
    };
    renderReads();

    const picker = sequencePicker("Add a read", (sd) => {
      reads.push({ name: sd.name || `read ${reads.length + 1}`, seqData: sd });
      renderReads();
    });
    const addMany = U.button("Add read files\u2026", async () => {
      const picked = await pickFiles(true);
      picked.forEach((sd) => reads.push({ name: sd.name || `read ${reads.length + 1}`, seqData: sd }));
      renderReads();
    }, { icon: "folder-open" });

    const check = wrapTry(() => {
      out.innerHTML = "";
      if (!reads.length) throw new Error("Add at least one read");
      const refSeq = construct.sequence;
      const features = (construct.features || []).filter((f) => f && f.name);

      const reports = reads.map((r) => {
        // a read of a plasmid can run off the end and carry on at base 1
        const aligned = construct.circular
          ? AL.alignCircular(refSeq, r.seqData.sequence)
          : AL.alignBestStrand(refSeq, r.seqData.sequence);
        return CC.readReport({ ...aligned, name: r.name, reversed: aligned.reversed });
      });

      const v = CC.verdict(reports, refSeq.length);
      out.appendChild(U.callout(v.text, v.level));

      out.appendChild(
        U.table(
          [
            { title: "Read", render: (r) => r.name },
            { title: "Strand", render: (r) => (r.reversed ? "reverse" : "forward") },
            { title: "Covers", render: (r) => (r.start === null ? "nothing" : `${oneBased(r.start)}\u2013${oneBased(r.end)} (${r.covered} bp)`) },
            { title: "Identity", render: (r) => `${U.fmt(r.identity, 1)}%` },
            {
              title: "Differences",
              render: (r) => {
                const n = r.mismatches.length + r.insertions.length + r.deletions.length;
                return n ? h("span", { className: "ove-cl-warn" }, String(n)) : "none";
              },
            },
          ],
          reports
        )
      );

      const diffs = [];
      reports.forEach((r) => {
        r.mismatches.forEach((m) =>
          diffs.push({ read: r.name, at: m.at, what: `${m.ref} \u2192 ${m.read}`, kind: "substitution", newBase: m.read })
        );
        r.insertions.forEach((i) => diffs.push({ read: r.name, at: i.at, what: `+${i.bases}`, kind: "insertion" }));
        r.deletions.forEach((d) => diffs.push({ read: r.name, at: d.at, what: `\u2212${d.length} bp`, kind: "deletion" }));
      });
      diffs.sort((a, b) => a.at - b.at);

      if (diffs.length) {
        out.appendChild(
          U.table(
            [
              { title: "Position", render: (d) => String(oneBased(d.at)) },
              { title: "Change", render: (d) => h("span", { className: "ove-cl-seq" }, d.what) },
              { title: "In", render: (d) => CC.featuresAt(features, d.at).join(", ") || "\u2013" },
              {
                title: "Effect",
                render: (d) => {
                  if (d.kind !== "substitution") {
                    const inCds = features.some((f) => String(f.type).toUpperCase() === "CDS" && d.at >= f.start && d.at <= f.end);
                    return inCds ? h("span", { className: "ove-cl-warn" }, "frameshift risk") : "\u2013";
                  }
                  const hit = features
                    .filter((f) => String(f.type).toUpperCase() === "CDS")
                    .map((f) => CC.consequence(refSeq, f, d.at, d.newBase))
                    .find(Boolean);
                  if (!hit) return "\u2013";
                  return h("span", { className: hit.kind === "silent" ? "" : "ove-cl-warn" }, hit.text);
                },
              },
              { title: "Seen in", render: (d) => d.read },
            ],
            diffs
          )
        );
      }

      const cov = CC.coverage(reports, refSeq.length);
      if (cov.gaps.length) {
        out.appendChild(
          h(
            "div",
            { className: "ove-cl-hint" },
            `Not read: ${cov.gaps.slice(0, 8).map((g) => `${oneBased(g.start)}\u2013${oneBased(g.end)}`).join(", ")}${cov.gaps.length > 8 ? `, and ${cov.gaps.length - 8} more` : ""}.`
          )
        );
      }
      out.appendChild(
        U.button("Copy report", () => U.copyText(reportText(reports, diffs, cov, v), "Report copied"), { icon: "clipboard" })
      );
    });

    function reportText(reports, diffs, cov, v) {
      const lines = [`${name}: ${v.text}`, ""];
      reports.forEach((r) =>
        lines.push(
          `${r.name}\t${r.reversed ? "reverse" : "forward"}\t${r.start === null ? "no match" : `${oneBased(r.start)}-${oneBased(r.end)}`}\t${r.identity.toFixed(1)}%`
        )
      );
      if (diffs.length) {
        lines.push("", "position\tchange\tread");
        diffs.forEach((d) => lines.push(`${oneBased(d.at)}\t${d.what}\t${d.read}`));
      }
      if (cov.gaps.length) {
        lines.push("", `unread: ${cov.gaps.map((g) => `${oneBased(g.start)}-${oneBased(g.end)}`).join(", ")}`);
      }
      return lines.join("\n");
    }

    U.openDialog({
      title: "Check a Clone Against Its Sanger Reads",
      width: 960,
      body: [
        templatePicker("Construct", "cloneCheck", template),
        U.section("Reads", U.row(picker, addMany), readsBox),
        out,
      ],
      footer: [U.button("Check", check, { intent: "primary", icon: "endorsed" })],
    });
  }

  // ------------------------------------------------------- golden gate
  // One pot, one enzyme, parts that carry their own overhangs. The work is
  // not the ligation -- src/cloning/goldenGate.js already decides the order
  // -- it is saying plainly what the overhangs will do.
  function openGoldenGate({ template } = {}) {
    const GG = window.oveGoldenGate;
    const { seqData: vector, name } = current(template);
    const enzymeIn = enzymeInput("BsaI", vector);
    const productName = U.textInput(`${name}_assembly`, { width: 220 });
    const partsBox = h("div");
    const out = h("div");
    const inserts = [];

    const renderParts = () => {
      partsBox.innerHTML = "";
      if (!inserts.length) {
        partsBox.appendChild(h("div", { className: "ove-cl-hint" }, "No parts yet \u2014 add the plasmids (or PCR products) carrying them."));
        return;
      }
      partsBox.appendChild(
        U.table(
          [
            { title: "Part", render: (p) => p.name },
            { title: "Length", render: (p) => `${p.seqData.sequence.length} bp` },
            {
              title: "",
              render: (p) =>
                U.button("Remove", () => {
                  inserts.splice(inserts.indexOf(p), 1);
                  renderParts();
                }, { icon: "cross" }),
            },
          ],
          inserts
        )
      );
    };
    renderParts();

    const picker = sequencePicker("Add a part", (sd) => {
      inserts.push({ name: sd.name || `part ${inserts.length + 1}`, seqData: sd });
      renderParts();
    });

    // every fragment of this input that could sit inside the circle
    const candidatesOf = (seqData, enzyme) => {
      const frags = D.digest(seqData, [enzyme]);
      if (frags[0] && frags[0].uncut) return [];
      return frags.filter(GG.usable).map((f) => ({ left: f.left, right: f.right, size: f.size, frag: f }));
    };

    const assemble = wrapTry(() => {
      out.innerHTML = "";
      const enzyme = enzymeIn.input.value.trim();
      if (!enzyme) throw new Error("Choose a Type IIS enzyme (BsaI, BsmBI, BbsI\u2026)");
      checkEnzymes([enzyme]);
      if (!window.oveEnzymeTable.cutsOutsideSite(D.getEnzyme(enzyme))) {
        out.appendChild(U.callout(`${enzyme} cuts inside its own recognition site, so it cannot leave the custom overhangs Golden Gate needs.`, "warning"));
      }
      if (!inserts.length) throw new Error("Add at least one part");

      const parts = [{ name: `${name} (vector)`, seqData: vector }, ...inserts].map((p) => ({
        name: p.name,
        seqData: p.seqData,
        candidates: candidatesOf(p.seqData, enzyme),
      }));
      const missed = parts.filter((p) => !p.candidates.length);
      if (missed.length) {
        out.appendChild(U.callout(`${enzyme} does not release anything from ${missed.map((p) => p.name).join(", ")}. A part needs a site on both sides, pointing inwards.`, "danger"));
        return;
      }

      const order = GG.chain(parts);
      if (!order) {
        const stuck = GG.unmatched(parts);
        out.appendChild(
          U.callout(
            stuck.length
              ? `These parts do not make a circle: ${stuck.map((u) => `${u.name}'s ${u.overhang} overhang has nothing to join`).join("; ")}.`
              : "These parts do not make a circle. Check that each overhang appears on exactly two parts.",
            "danger"
          )
        );
        out.appendChild(overhangTable(parts));
        return;
      }

      GG.problems(order).forEach((p) => out.appendChild(U.callout(p.text, p.level)));

      const pieces = order.map((step) => D.fragmentPiece(parts[step.index].seqData, step.fragment.frag, false));
      const product = D.ligateCircular(pieces, productName.value || "assembly");
      if (!product) throw new Error("The parts line up but will not ligate \u2014 please report this sequence");

      // the enzyme sites go with the carrier plasmids: if any survive, the
      // product will be cut again in the same pot
      const leftover = D.cutPositions(product, [enzyme]).length;
      out.appendChild(
        U.callout(
          leftover
            ? `${leftover} ${enzyme} site${leftover > 1 ? "s" : ""} survive in the product, so it will be cut again in the pot. A part should carry its sites outside the piece being assembled.`
            : `No ${enzyme} sites left in the product, so it is safe from the enzyme once assembled.`,
          leftover ? "danger" : "success"
        )
      );

      const previewPieces = order.map((step, i) => ({
        name: step.name,
        sequence: pieces[i].full.sequence.slice(0, pieces[i].full.sequence.length - ((pieces[i].right && pieces[i].right.seq.length) || 0)),
      }));
      out.appendChild(productSummary({ pieces: previewPieces, sequence: product.sequence, circular: true }));
      out.appendChild(
        ligationView(
          PV.ligationJoins({
            pieces: previewPieces.map((p) => ({ name: p.name, length: p.sequence.length })),
            joins: order.map((step) => ({ overhang: (step.fragment.right && step.fragment.right.seq) || "", enzymes: [enzyme] })),
            sequence: product.sequence,
            circular: true,
          })
        )
      );
      out.appendChild(
        h(
          "div",
          { style: { display: "flex", gap: "6px", marginTop: "8px" } },
          U.button("Open product", () => openInNewWindow(product), { intent: "primary", icon: "document-open" }),
          U.button("Save product\u2026", () => saveSeqToFile(product, productName.value || "assembly"), { icon: "floppy-disk" })
        )
      );
    });

    function overhangTable(parts) {
      const rows = [];
      parts.forEach((p) =>
        p.candidates.forEach((c) =>
          rows.push({ name: p.name, size: c.size, left: (c.left && c.left.seq) || "blunt", right: (c.right && c.right.seq) || "blunt" })
        )
      );
      return U.table(
        [
          { title: "Part", render: (r) => r.name },
          { title: "Fragment", render: (r) => `${r.size} bp` },
          { title: "Left overhang", render: (r) => h("span", { className: "ove-cl-seq" }, r.left) },
          { title: "Right overhang", render: (r) => h("span", { className: "ove-cl-seq" }, r.right) },
        ],
        rows
      );
    }

    U.openDialog({
      title: "Golden Gate / MoClo Assembly",
      width: 940,
      body: [
        templatePicker("Destination vector", "goldenGate", template),
        U.section("Enzyme", U.row(U.field("Type IIS enzyme", enzymeIn.el, "BsaI, BsmBI, BbsI\u2026"), U.field("Product name", productName))),
        U.section("Parts", picker, partsBox),
        out,
      ],
      footer: [U.button("Assemble", assemble, { intent: "primary", icon: "build" })],
    });
  }

  // ------------------------------------------------------ enzyme table
  // Which enzymes the map shows. Cutters are bold; a non-cutter can be
  // chosen on purpose, so that if an edit ever creates that site it turns up
  // on the map where you will notice it.
  function openEnzymeTable({ template } = {}) {
    const ET = window.oveEnzymeTable;
    const EV = window.oveEnzymeVendors;
    const VENDOR_KEY = "ove-enzyme-vendor";
    const POOL_KEY = "ove-enzyme-pool";
    let vendorCode = "N"; // New England Biolabs, the usual freezer
    try {
      const saved = localStorage.getItem(VENDOR_KEY);
      if (saved !== null) vendorCode = saved;
    } catch (e) {
      /* a blocked localStorage is not worth failing over */
    }
    // which enzymes are even on the table: everything the database knows, or
    // only what you could order. Catalogue enzymes by default -- a row for an
    // enzyme nobody sells is a row you cannot act on.
    const POOLS = [
      { value: "commercial", label: "All commercial", test: (r) => EV.vendorsFor(r.name).length > 0 },
      ...EV.VENDOR_LIST.map((v) => ({ value: v.code, label: v.name, test: (r) => EV.sells(v.code, r.name) })),
      { value: "all", label: "Everything in the database", test: () => true },
    ];
    let poolValue = "commercial";
    try {
      const savedPool = localStorage.getItem(POOL_KEY);
      if (savedPool && POOLS.some((p) => p.value === savedPool)) poolValue = savedPool;
    } catch (e) {
      /* no stored preference */
    }
    const poolPicker = U.select(POOLS.map((p) => ({ value: p.value, label: p.label })), poolValue, { width: 230 });
    const { seqData, name } = current(template);
    const doc = window.oveTabs && window.oveTabs.getActive();
    const editorApi = doc && doc.editor;
    const selected = {};
    ((editorApi && editorApi.getState().restrictionEnzymes) || {}).filteredRestrictionEnzymes?.forEach((e) => {
      if (e && e.value && !e.cutsThisManyTimes && e.value !== "type2s") selected[e.value.toLowerCase()] = true;
    });

    // one pass over the whole enzyme list; a 6 kb plasmid takes well under a
    // second, and the answer only changes when the sequence does
    const rows = Object.keys(D.enzymesByName)
      .map((key) => {
        const enz = D.enzymesByName[key];
        let cuts = [];
        try {
          cuts = D.cutPositions(seqData, [enz.name]).map((c) => oneBased(Math.min(c.top, c.bottom)));
        } catch (e) {
          return null;
        }
        return ET.row(enz, cuts);
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
    const inPool = () => {
      const pool = POOLS.find((p) => p.value === poolPicker.select.value) || POOLS[0];
      return rows.filter(pool.test);
    };
    const regroup = () =>
      ET.groupIsoschizomers(inPool(), {
        preferred: D.COMMON_ENZYMES,
        sells: (n) => EV.sells(vendorCode, n),
        sold: (n) => EV.vendorsFor(n).length > 0,
      }).sort((a, b) => a.name.localeCompare(b.name));
    let grouped = regroup();

    const vendorPicker = U.select(
      [{ value: "", label: "Any supplier" }, ...EV.VENDOR_LIST.map((v) => ({ value: v.code, label: v.name }))],
      vendorCode,
      { width: 230 }
    );
    const query = U.textInput("", { width: 220 });
    const shareRow = U.checkbox("isoschizomers share a row", true);
    const cutsFilter = U.select(ET.FILTERS.map((f) => ({ value: f.value, label: f.label })), "one-long", { width: 200 });
    const tableBox = h("div", { style: { maxHeight: "420px", overflow: "auto" } });
    const countLine = h("div", { className: "ove-cl-hint" });

    // panels you keep, as opposed to the set saved with this one sequence
    const ES = window.oveEnzymeSets;
    const store = (() => {
      try {
        return window.localStorage;
      } catch (e) {
        return null;
      }
    })();
    const setsPicker = U.select([{ value: "", label: "\u2014 saved sets \u2014" }], "", { width: 200 });
    const refreshSets = () => {
      const chosen = setsPicker.select.value;
      setsPicker.select.innerHTML = "";
      [{ value: "", label: "\u2014 saved sets \u2014" }, ...ES.names(store).map((n) => ({ value: n, label: n }))].forEach((o) => {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        setsPicker.select.appendChild(opt);
      });
      setsPicker.select.value = ES.names(store).includes(chosen) ? chosen : "";
    };

    const nameTitle = (r) => {
      const who = EV.vendorsFor(r.name);
      return [
        who.length ? `Sold by ${who.join(", ")}` : "No supplier listed",
        r.aliases.length ? `Same site and cut as ${r.aliases.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    };

    const MAX_ROWS = 300;
    // how many enzymes each filter would show, on the dropdown itself: the
    // question "are there any two-cutters" is answered without clicking
    const updateFilterCounts = (source) => {
      [...cutsFilter.select.options].forEach((opt) => {
        const f = ET.FILTERS.find((x) => x.value === opt.value);
        if (!f) return;
        opt.textContent = `${f.label} (${ET.filter(source, { query: query.value, cuts: f.value, selected: {} }).length})`;
      });
    };
    const draw = () => {
      const source = shareRow.input.checked ? grouped : inPool();
      updateFilterCounts(source);
      const shown = ET.filter(source, { query: query.value, cuts: cutsFilter.select.value, selected });
      const capped = shown.slice(0, MAX_ROWS);
      tableBox.innerHTML = "";
      tableBox.appendChild(
        U.table(
          [
            {
              title: "On map",
              render: (r) => {
                const box = U.checkbox("", !!selected[r.key]);
                box.input.addEventListener("change", () => {
                  if (box.input.checked) selected[r.key] = true;
                  else delete selected[r.key];
                  apply();
                  countLine.textContent = summary();
                });
                return box.el;
              },
            },
            {
              title: "Name",
              render: (r) =>
                h(
                  "span",
                  { className: r.cuts ? "ove-cl-cutter" : "ove-cl-noncutter", title: nameTitle(r) },
                  r.name
                ),
            },
            { title: "Site", render: (r) => h("span", { className: "ove-cl-seq" }, r.site) },
            { title: "Overhang", render: (r) => r.overhang + (r.isType2S ? " \u00b7 Type IIS" : "") },
            { title: "Cuts", render: (r) => String(r.cuts) },
            { title: "Positions", render: (r) => (r.cuts ? r.positions.slice(0, 6).join(", ") + (r.cuts > 6 ? ` +${r.cuts - 6}` : "") : "\u2013") },
          ],
          capped
        )
      );
      countLine.textContent = summary(shown.length, capped.length);
    };

    function summary(shownCount, drawnCount) {
      const chosen = Object.keys(selected).length;
      const source = shareRow.input.checked ? grouped : inPool();
      const cutters = source.filter((r) => r.cuts).length;
      const extra = shownCount !== undefined && drawnCount !== undefined && shownCount > drawnCount ? ` Showing the first ${drawnCount} of ${shownCount} \u2014 narrow the filter to see the rest.` : "";
      return `${cutters} of ${source.length} enzymes cut ${name}. ${chosen ? `${chosen} chosen for the map` : "Nothing chosen: the map shows OVE's own filter"}.${extra}`;
    }

    const apply = () => {
      if (!editorApi) return;
      editorApi.updateEditor({ restrictionEnzymes: { filteredRestrictionEnzymes: ET.toMapFilter(selected) } });
    };

    refreshSets();
    query.addEventListener("input", draw);
    cutsFilter.select.addEventListener("change", draw);
    shareRow.input.addEventListener("change", draw);
    poolPicker.select.addEventListener("change", () => {
      try {
        localStorage.setItem(POOL_KEY, poolPicker.select.value);
      } catch (e) {
        /* preference just will not stick */
      }
      grouped = regroup();
      draw();
    });
    vendorPicker.select.addEventListener("change", () => {
      vendorCode = vendorPicker.select.value;
      try {
        localStorage.setItem(VENDOR_KEY, vendorCode);
      } catch (e) {
        /* preference just will not stick */
      }
      grouped = regroup();
      draw();
    });
    draw();

    U.openDialog({
      title: "Enzymes on the map",
      width: 940,
      body: [
        templatePicker("Sequence", "enzymes", template),
        U.row(U.field("Choose from", poolPicker.el, "which enzymes are on the table"), U.field("Show", cutsFilter.el), U.field("Filter", query, "name or recognition site")),
      U.row(U.field("Name them as", vendorPicker.el, "whose catalogue name to show"), shareRow.el),
        countLine,
        tableBox,
        U.callout(
          "Bold enzymes cut this sequence; faded ones do not. Choosing an enzyme that does not cut is deliberate \u2014 it stays on the map, so if an edit or an assembly ever creates that site, it appears where you will see it. The set is saved with the sequence the next time you save it. Hover a name to see its other names and who sells it.",
          "none"
        ),
      ],
      footer: [
        U.field("Set", setsPicker.el),
        U.button("Apply", () => {
          const picked = setsPicker.select.value;
          if (!picked) return U.toast("Choose a saved set first", "warning");
          Object.keys(selected).forEach((k) => delete selected[k]);
          ES.get(store, picked).forEach((k) => (selected[k] = true));
          apply();
          draw();
          U.toast(`Applied "${picked}"`, "success");
        }, { icon: "tick" }),
        U.button("Save as\u2026", () => {
          const chosen = Object.keys(selected);
          if (!chosen.length) return U.toast("Tick some enzymes first", "warning");
          const label = window.prompt("Name this set", setsPicker.select.value || "my panel");
          if (!label) return;
          ES.save(store, label, chosen);
          refreshSets();
          setsPicker.select.value = label.trim();
          U.toast(`Saved "${label.trim()}" \u2014 ${chosen.length} enzymes`, "success");
        }, { icon: "floppy-disk" }),
        U.button("Delete set", () => {
          const picked = setsPicker.select.value;
          if (!picked) return U.toast("Choose a saved set first", "warning");
          ES.remove(store, picked);
          refreshSets();
        }, { icon: "trash" }),
        U.button("Clear the map filter", () => {
          Object.keys(selected).forEach((k) => delete selected[k]);
          apply();
          draw();
        }, { icon: "filter-remove" }),
      ],
    });
  }

  // --------------------------------------------------- check digest
  // After a cloning, the question is which enzyme tells a right colony from
  // a wrong one. Cut the construct every way the common enzymes allow, cut
  // the parent the same way, and rank by what you could actually read off a
  // gel (src/cloning/checkDigest.js does the scoring).
  function openCheckDigest({ template } = {}) {
    const { seqData: construct } = current(template);
    const CD = window.oveCheckDigest;
    const agarose = U.select(Object.keys(D.AGAROSE_RANGES).map((k) => ({ value: k, label: `${k}% agarose` })), "1", { width: 140 });
    const pairsOn = U.checkbox("also try pairs of enzymes", true);
    const out = h("div");
    let parent = null;
    const parentBox = h("div", { className: "ove-cl-hint" }, "No parent chosen: digests are ranked on readability alone.");
    const picker = sequencePicker("Parent / empty vector (optional)", (sd) => {
      parent = sd;
      parentBox.textContent = `Parent: ${sd.name} \u2014 ${sd.sequence.length} bp`;
      run();
    });

    // an enzyme that misses the parent still leaves it as one whole-length
    // band -- treating that as an empty lane would make every clone band
    // look new
    const bandsOf = (sd, enzymes) => {
      try {
        const frags = D.digest(sd, enzymes);
        if (frags[0] && frags[0].uncut) return { uncut: true, sizes: [sd.sequence.length] };
        return { uncut: false, sizes: frags.map((f) => f.size) };
      } catch (e) {
        return { uncut: true, sizes: [sd.sequence.length] };
      }
    };

    const run = wrapTry(() => {
      const range = D.AGAROSE_RANGES[agarose.select.value] || D.AGAROSE_RANGES[1];
      const cutters = D.COMMON_ENZYMES.filter((e) => !bandsOf(construct, [e]).uncut);
      const combos = cutters.map((e) => [e]);
      if (pairsOn.input.checked) {
        for (let i = 0; i < cutters.length; i++) {
          for (let j = i + 1; j < cutters.length; j++) combos.push([cutters[i], cutters[j]]);
        }
      }
      const ranked = CD.rank(
        combos.map((enzymes) => ({
          enzymes: enzymes,
          bands: bandsOf(construct, enzymes).sizes,
          referenceBands: parent ? bandsOf(parent, enzymes).sizes : undefined,
        })),
        { range: range }
      );
      const top = ranked.filter((r) => r.score > -50).slice(0, 12);
      out.innerHTML = "";
      if (!top.length) {
        out.appendChild(U.callout("None of the common enzymes gives a digest worth running on this construct.", "warning"));
        return;
      }
      out.appendChild(
        U.table(
          [
            { title: "Cut with", render: (r) => r.enzymes.join(" + ") },
            { title: "Clone", render: (r) => r.bands.map((b) => `${b}`).join(", ") + " bp" },
            { title: "Parent", render: (r) => (r.referenceBands ? r.referenceBands.slice().sort((a, b) => b - a).join(", ") + " bp" : "\u2013") },
            {
              title: "Verdict",
              render: (r) =>
                h("span", { className: r.verdict === "clear" ? "" : "ove-cl-warn", title: r.reasons.join("; ") }, r.verdict),
            },
            { title: "Why", render: (r) => (r.reasons.length ? r.reasons.join("; ") : "bands are well spread and all on scale") },
            {
              title: "",
              render: (r) =>
                U.button("Show on gel", () => openGelSimulator({ template: construct, withEnzymes: r.enzymes.join(", ") }), { icon: "timeline-bar-chart" }),
            },
          ],
          top
        )
      );
    });
    agarose.select.addEventListener("change", run);
    pairsOn.input.addEventListener("change", run);
    run();

    U.openDialog({
      title: "Check Digest (which cut proves the clone)",
      width: 980,
      body: [
        templatePicker("Clone", "checkDigest", template),
        U.section("Compare against", picker, parentBox),
        U.section("Gel", U.row(U.field("Agarose", agarose.el), pairsOn.el)),
        out,
      ],
    });
  }

  function openGelSimulator({ template, withEnzymes } = {}) {
    const { seqData } = current(template);
    const agarose = U.select(Object.keys(D.AGAROSE_RANGES).map((k) => ({ value: k, label: `${k}% agarose` })), "1", { width: 140 });
    const ladder = U.select(Object.keys(D.LADDERS), "GeneRuler 1 kb Plus", { width: 200 });
    const singles = D.COMMON_ENZYMES.filter((e) => {
      try {
        return D.cutPositions(seqData, [e]).length === 1;
      } catch (err) {
        return false;
      }
    });
    // arriving from the check digest: show the uncut clone beside that cut
    const lanes = withEnzymes
      ? [
          { source: 0, enzymes: "" },
          { source: 0, enzymes: withEnzymes },
        ]
      : [
          { source: 0, enzymes: "" },
          ...(singles[0] ? [{ source: 0, enzymes: singles[0] }] : []),
          ...(singles[1] ? [{ source: 0, enzymes: `${singles[0]}, ${singles[1]}` }] : []),
        ];
    const lanesBox = h("div");
    const gelBox = h("div", { style: { display: "flex", gap: "16px", alignItems: "flex-start" } });

    const sources = () => availableSequences();

    function renderLanes() {
      const srcs = sources();
      lanesBox.innerHTML = "";
      lanesBox.appendChild(
        U.table(
          [
            { title: "Lane", render: (_, i) => i + 2 },
            {
              title: "Sample",
              render: (lane) => {
                const s = U.select(srcs.map((o, i) => ({ value: String(i), label: `${o.name}, ${o.seqData.sequence.length} bp` })), String(lane.source), { width: 280 });
                s.select.addEventListener("change", () => {
                  lane.source = +s.select.value;
                  drawGel();
                });
                return s.el;
              },
            },
            {
              title: "Enzymes (comma-separated, empty = uncut)",
              render: (lane) => {
                const inp = U.textInput(lane.enzymes, { width: 200, placeholder: "uncut" });
                inp.addEventListener("change", () => {
                  lane.enzymes = inp.value;
                  drawGel();
                });
                return inp;
              },
            },
            {
              title: "",
              render: (lane, i) =>
                U.button("", () => {
                  lanes.splice(i, 1);
                  renderLanes();
                  drawGel();
                }, { minimal: true, icon: "trash", title: "Remove lane" }),
            },
          ],
          lanes
        )
      );
    }

    function drawGel() {
      const pct = agarose.select.value;
      const ladderSizes = D.LADDERS[ladder.select.value];
      const srcs = sources();
      const laneData = lanes.map((lane) => {
        const src = srcs[lane.source] || srcs[0];
        const enz = lane.enzymes.split(/[,\s]+/).filter(Boolean);
        try {
          checkEnzymes(enz);
          return { title: src.name, enz, bands: D.laneBands(src.seqData, enz) };
        } catch (e) {
          return { title: src.name, enz, bands: [], error: e.message };
        }
      });
      const laneW = 64;
      const left = 70;
      const top = 36;
      const H = 400;
      const W = left + laneW * (laneData.length + 1) + 20;
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", W);
      svg.setAttribute("height", top + H + 20);
      svg.setAttribute("class", "ove-cl-gel");
      const add = (tag, attrs, text) => {
        const e = document.createElementNS(ns, tag);
        Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
        if (text !== undefined) e.textContent = text;
        svg.appendChild(e);
        return e;
      };
      add("rect", { x: 0, y: 0, width: W, height: top + H + 20, fill: "#111" });
      const y = (bp) => top + D.migration(bp, +pct) * H;
      const laneX = (i) => left + i * laneW + 8;
      // wells + lane numbers
      for (let i = 0; i <= laneData.length; i++) {
        add("rect", { x: laneX(i), y: top - 10, width: laneW - 16, height: 6, fill: "#444" });
        add("text", { x: laneX(i) + (laneW - 16) / 2, y: 16, fill: "#aaa", "font-size": 11, "text-anchor": "middle" }, i + 1);
      }
      // ladder
      ladderSizes.forEach((bp) => {
        const yy = y(bp);
        const r = add("rect", { x: laneX(0), y: yy - 1.5, width: laneW - 16, height: 3, fill: "#fff", opacity: [3000, 1000, 500].includes(bp) ? 1 : 0.75 });
        add("title", {}, `${bp} bp`);
        r.appendChild(svg.lastChild);
        add("text", { x: left - 6, y: yy + 3, fill: "#ddd", "font-size": 10, "text-anchor": "end" }, bp >= 1000 ? `${bp / 1000} kb` : `${bp}`);
      });
      // samples
      laneData.forEach((lane, i) => {
        lane.bands.forEach((b) => {
          const yy = y(b.apparent);
          const r = add("rect", { x: laneX(i + 1), y: yy - 2, width: laneW - 16, height: 4, fill: "#fff", opacity: Math.max(0.25, Math.min(1, b.intensity)) });
          const t = document.createElementNS(ns, "title");
          t.textContent = b.label;
          r.appendChild(t);
        });
        if (lane.error) add("text", { x: laneX(i + 1) + 4, y: top + 20, fill: "#f66", "font-size": 10 }, "error");
      });
      const legend = U.table(
        [
          { title: "Lane", render: (_, i) => i + 1 },
          { title: "Sample", render: (l) => l.title },
          { title: "Enzymes", render: (l) => (l.enz.length ? l.enz.join(" + ") : "uncut") },
          { title: "Bands", render: (l) => (l.error ? h("span", { className: "ove-cl-warn" }, l.error) : l.bands.map((b) => b.label).join(", ")) },
        ],
        [{ title: ladder.select.value, enz: [], bands: [], ladder: true }, ...laneData].map((l) => (l.ladder ? { ...l, bands: ladderSizes.map((s) => ({ label: `${s}` })), enz: ["ladder"] } : l))
      );
      gelBox.innerHTML = "";
      gelBox.appendChild(svg);
      gelBox.appendChild(h("div", { style: { flex: "1", minWidth: "260px" } }, legend, U.callout("Band positions are a log-linear approximation of agarose migration. Uncut plasmids show supercoiled (fast) and nicked (slow) forms.", "none")));
      gelBox._svg = svg;
    }

    [agarose.select, ladder.select].forEach((s) => s.addEventListener("change", drawGel));
    renderLanes();
    drawGel();

    const copyImage = wrapTry(async () => {
      const svg = gelBox._svg;
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = svg.width.baseVal.value * 2;
      canvas.height = svg.height.baseVal.value * 2;
      const ctx = canvas.getContext("2d");
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      U.toast("Gel image copied to clipboard");
    });

    U.openDialog({
      title: "Agarose Gel Simulator",
      width: 980,
      body: [
        templatePicker("Sequence", "gel", template),
        U.row(U.field("Gel", agarose.el), U.field("Ladder (lane 1)", ladder.el)),
        U.section("Lanes", lanesBox),
        gelBox,
      ],
      footer: [
        U.button("Add lane", () => {
          lanes.push({ source: 0, enzymes: "" });
          renderLanes();
          drawGel();
        }, { icon: "add" }),
        U.button("Add sample from file…", async () => {
          const got = await pickFiles(true);
          if (got.length) {
            const srcs = sources();
            got.forEach((g) => lanes.push({ source: srcs.findIndex((s) => s.seqData === g), enzymes: "" }));
            renderLanes();
            drawGel();
          }
        }, { icon: "folder-open" }),
        U.button("Copy gel image", copyImage, { icon: "clipboard" }),
      ],
    });
  }

  // ------------------------------------------------------------- wiring
  const TOOLS = {
    primers: openPrimerDesigner,
    oligo: openOligoAnalyzer,
    mutagenesis: openMutagenesis,
    restriction: openRestrictionCloning,
    gibson: openGibson,
    gel: openGelSimulator,
    checkDigest: openCheckDigest,
    enzymes: openEnzymeTable,
    goldenGate: openGoldenGate,
    cloneCheck: openCloneCheck,
    codons: openCodonTable,
  };
  function open(tool) {
    if (!editor) return U.toast("Editor not ready yet", "warning");
    wrapTry(TOOLS[tool])();
  }

  const cloningMenu = {
    text: "Cloning",
    submenu: [
      { text: "Design PCR Primers…", icon: "exchange", onClick: () => open("primers") },
      { text: "Primer / Oligo Analyzer (Tm, dimers, binding sites)…", icon: "calculator", onClick: () => open("oligo") },
      { text: "Site-Directed Mutagenesis…", icon: "edit", onClick: () => open("mutagenesis") },
      "--",
      { text: "Restriction Cloning (digest + ligate)…", icon: "cut", onClick: () => open("restriction") },
      { text: "Gibson / HiFi Assembly…", icon: "build", onClick: () => open("gibson") },
      { text: "Golden Gate / MoClo Assembly…", icon: "layout-hierarchy", onClick: () => open("goldenGate") },
      "--",
      { text: "Enzymes on the Map…", icon: "th-list", onClick: () => open("enzymes") },
      { text: "Check Digest (which cut proves the clone)…", icon: "endorsed", onClick: () => open("checkDigest") },
      { text: "Check a Clone Against Its Sanger Reads…", icon: "confirm", onClick: () => open("cloneCheck") },
      { text: "Agarose Gel Simulator…", icon: "timeline-bar-chart", onClick: () => open("gel") },
      { text: "Codon Usage Table…", icon: "th", onClick: () => open("codons") },
      "simulateDigestion",
      "simulatePCR",
    ],
  };
  // stable reference, as OVE memoizes on it
  function menuFilter(menu) {
    const i = menu.findIndex((m) => m && m.text === "Tools");
    const at = i === -1 ? menu.length : i + 1;
    return [...menu.slice(0, at), cloningMenu, ...menu.slice(at)];
  }

  window.oveCloning = {
    setEditor: (e) => (editor = e),
    menuFilter,
    open,
    findBindingSites,
    codonInfo,
    session,
  };
})();
