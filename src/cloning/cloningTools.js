// The "Cloning" menu: primer design, oligo analysis, mutagenesis, restriction
// cloning, Gibson/HiFi assembly and gel simulation. Calculations live in
// dnaTools.js; this file is only UI and editor wiring.
(function () {
  const U = window.oveCloningUI;
  const D = window.dnaTools;
  const su = window.sequenceUtils;
  const { h } = U;

  let editor = null;
  const session = []; // constructs/products made in this window, reusable as inputs
  const pickedFiles = [];

  // ------------------------------------------------------------ helpers
  function current() {
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
  function availableSequences() {
    const { seqData, name } = current();
    return [{ name: `${name} (current tab)`, seqData }, ...session.map((s) => ({ name: `${s.name} (made this session)`, seqData: s.seqData })), ...pickedFiles.map((f) => ({ name: `${f.name} (file)`, seqData: f.seqData }))];
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

  function openPrimerDesigner() {
    const { seqData, sel, name } = current();
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
          { onSelect: (p) => (chosen = p), selectedIndex: 0 }
        ),
        U.callout(
          "Tm is for the annealing part only (tails in lowercase orange). Ta: Taq ≈ lower Tm − 5 °C; Q5/Phusion ≈ lower Tm + 3 °C (max 72). Hover ⚠ for details. Click a row to choose it.",
          "none"
        )
      );
    });

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
    ];

    U.openDialog({
      title: "Design PCR Primers",
      width: 900,
      body: [
        U.callout(sel ? `Region from your selection (${oneBased(sel.start)}–${oneBased(sel.end)}).` : "Tip: select a region in the sequence before opening this tool to fill in From/To.", "primary"),
        U.section("Region to amplify", U.row(U.field("From", from), U.field("To", to), U.field("Allow primers outside region (bp)", flank, "0 = primers start exactly at the ends (for cloning)"), U.field("Primer name prefix", nameIn))),
        U.section("Primer rules", U.row(U.field("Target Tm °C", tmT), U.field("Min Tm", tmMin), U.field("Max Tm", tmMax), U.field("Min length", lenMin), U.field("Max length", lenMax)), cond.el),
        U.section("5′ additions (restriction sites, Kozak, tags…)", U.row(fTail.el, rTail.el)),
        results,
      ],
      footer,
    });
  }

  // ------------------------------------------------------ oligo analyzer
  function findBindingSites(template, circular, oligoIn, maxMismatches = 2) {
    const oligo = D.clean(oligoIn);
    const L = oligo.length;
    const n = template.length;
    const T = template.toUpperCase();
    const hits = [];
    if (L < 8) return hits;
    const scan = (probe, strand) => {
      const limit = circular ? n : n - L + 1;
      for (let i = 0; i < limit; i++) {
        let mm = 0;
        for (let k = 0; k < L && mm <= maxMismatches; k++) {
          const t = T[(i + k) % n];
          if (probe[k] !== t && probe[k] !== "N") {
            // the 3′ end (last 5 nt of the primer) must match
            const primerIdx = strand === 1 ? k : L - 1 - k;
            if (primerIdx >= L - 5) mm = 99;
            else mm++;
          }
        }
        if (mm <= maxMismatches) hits.push({ start: i, end: (i + L - 1) % n, strand, mismatches: mm });
      }
    };
    scan(oligo, 1);
    scan(D.revcomp(oligo), -1);
    return hits;
  }

  function openOligoAnalyzer() {
    const { seqData, sel } = current();
    const selSeq = sel ? D.circSlice(seqData.sequence, sel.start, sel.end >= sel.start ? sel.end + 1 : sel.end + 1 + seqData.sequence.length, seqData.circular) : "";
    const o1 = U.textArea(selSeq.length <= 80 ? selSeq.toUpperCase() : "", { placeholder: "Oligo 1, 5′→3′", rows: 2 });
    const o2 = U.textArea("", { placeholder: "Oligo 2 (optional), 5′→3′ – for primer-pair checks", rows: 2 });
    const cond = conditionsEditor();
    const out = h("div");

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
      const seqs = [o1.value, o2.value].map(D.clean).filter((s) => s.length >= 2);
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

    const bindingSites = wrapTry(() => {
      out.innerHTML = "";
      const seqs = [o1.value, o2.value].map(D.clean).filter((s) => s.length >= 8);
      if (!seqs.length) throw new Error("Enter an oligo of at least 8 nt");
      const found = [];
      seqs.forEach((s, idx) => findBindingSites(seqData.sequence, seqData.circular, s).forEach((hit) => found.push({ ...hit, oligo: idx + 1, seq: s })));
      found.sort((a, b) => a.mismatches - b.mismatches);
      if (!found.length) {
        out.appendChild(U.callout("No binding sites with ≤ 2 mismatches (and a perfect 3′ end) in this sequence.", "warning"));
        return;
      }
      out.appendChild(
        U.table(
          [
            { title: "Oligo", render: (r) => r.oligo },
            { title: "Position", render: (r) => `${oneBased(r.start)}–${oneBased(r.end)}` },
            { title: "Strand", render: (r) => (r.strand === 1 ? "top (→)" : "bottom (←)") },
            { title: "Mismatches", render: (r) => (r.mismatches ? h("span", { className: "ove-cl-warn" }, r.mismatches) : h("span", { className: "ove-cl-ok" }, "0 (perfect)")) },
            {
              title: "",
              render: (r) =>
                U.button("Annotate", () => addPrimersToCurrent([{ name: `oligo${r.oligo}${r.mismatches ? `_${r.mismatches}mm` : ""}`, seq: r.seq, start: r.start, end: r.end, forward: r.strand === 1 }]), { minimal: true, icon: "add" }),
            },
          ],
          found
        )
      );
    });

    U.openDialog({
      title: "Primer / Oligo Analyzer",
      width: 720,
      body: [U.section("Oligos", o1, h("div", { style: { height: "6px" } }), o2), cond.el, out],
      footer: [
        U.button("Analyze", analyze, { intent: "primary", icon: "calculator" }),
        U.button("Find binding sites in this sequence", bindingSites, { icon: "search-template" }),
      ],
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

  function openMutagenesis() {
    const { seqData, sel, name } = current();
    const n = seqData.sequence.length;
    const cds = cdsFeatures(seqData);
    const mode = U.select(cds.length ? ["Change an amino acid", "Change bases (substitute / delete / insert)"] : ["Change bases (substitute / delete / insert)"], cds.length ? "Change an amino acid" : undefined, { width: 290 });
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

    const refresh = () => {
      const aaMode = mode.select.value.startsWith("Change an amino");
      aaWrap.style.display = aaMode ? "" : "none";
      baseWrap.style.display = aaMode ? "none" : "";
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

    U.openDialog({
      title: "Site-Directed Mutagenesis",
      width: 820,
      body: [U.section("What to change", U.field("Mode", mode.el), h("div", { style: { height: "8px" } }), aaWrap, baseWrap), U.section("Primer design", U.row(U.field("Method", method.el), U.field("Target Tm °C", tmT))), out],
      footer: [
        U.button("Design primers", design, { intent: "primary", icon: "search" }),
        U.button("Copy primers", wrapTry(() => {
          if (!result) throw new Error("Design primers first");
          U.copyText(primersTsv(result.primers), "Primers copied");
        }), { icon: "clipboard" }),
        U.button(
          "Open mutant plasmid",
          wrapTry(() => {
            if (!result) throw new Error("Design primers first");
            let mutant = D.mutateSeqData(seqData, { start: result.start, end: result.end, newBases: result.bases });
            mutant = { ...mutant, name: `${name}_${result.label}`, circular: seqData.circular };
            const m = mutant.sequence.toUpperCase();
            const doubled = m + m;
            const primers = [];
            result.primers.forEach((p, i) => {
              const probe = i === 0 ? p.seq.toUpperCase() : D.revcomp(p.seq).toUpperCase();
              const pos = doubled.indexOf(probe);
              if (pos >= 0) primers.push({ name: p.name, start: pos % m.length, end: (pos + probe.length - 1) % m.length, forward: i === 0, type: "primer_bind", notes: { note: [`5'-${p.seq}-3'`] } });
            });
            mutant.primers = [...(mutant.primers || []), ...primers];
            if (result.bases.length || result.end >= result.start) {
              mutant.features = [
                ...(mutant.features || []),
                { name: `mutation ${result.label}`, type: "misc_difference", start: result.start, end: Math.max(result.start, result.start + Math.max(result.bases.length, 1) - 1), forward: true },
              ];
            }
            openInNewWindow(su.tidyUpSequenceData(mutant, { annotationsAsObjects: false }));
          }),
          { icon: "document-open" }
        ),
      ],
    });
  }

  // --------------------------------------------------- restriction cloning
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

  function openRestrictionCloning() {
    const { seqData: vector, name } = current();
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
        iFragsBox.appendChild(fragmentTable([frag], (f) => (iFrag = f), 0));
        return;
      }
      checkEnzymes(names);
      const frags = D.digest(insert, names);
      // default: the fragment with enzyme cuts on both ends, else the largest
      const internal = frags.filter((f) => f.left && f.right && f.left.type !== "end" && f.right.type !== "end");
      const pick = (internal.length ? internal : frags).reduce((a, b) => (a.size > b.size ? a : b));
      iFrag = pick;
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
              render: (p) =>
                U.button("Open", () => openInNewWindow({ ...p.sequenceData, name: `${productName.value || "clone"}${res.products.length > 1 ? `_${p.orientation}` : ""}` }), { intent: "primary", icon: "document-open" }),
            },
          ],
          res.products
        )
      );
    });

    U.openDialog({
      title: "Restriction Cloning (digest + ligate)",
      width: 860,
      body: [
        U.section(`Vector: ${name} (${vector.sequence.length} bp, ${vector.circular ? "circular" : "linear"})`, U.row(U.field("Enzyme 1", vE1.el), U.field("Enzyme 2 (optional)", vE2.el)), vFragsBox),
        U.section("Insert", picker, h("div", { className: "ove-cl-hint", style: { marginBottom: "6px" } }, insertBox), U.row(U.field("Enzyme 1", iE1.el), U.field("Enzyme 2 (optional)", iE2.el, "leave both empty for a blunt, uncut PCR product")), iFragsBox),
        U.section("Product", U.row(U.field("Name", productName)), out),
      ],
      footer: [U.button("Ligate", ligate, { intent: "primary", icon: "link" })],
    });
  }

  // --------------------------------------------------------- Gibson / HiFi
  function openGibson() {
    const { seqData: vector, sel, caret, name } = current();
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
        U.callout(`Assembled construct: ${result.construct.sequence.length} bp. NEBuilder HiFi: 15–20 bp overlaps for 2–3 fragments; Gibson: 20–40 bp. PCR the inserts with these primers, then assemble.`, "none")
      );
    });

    U.openDialog({
      title: "Gibson / NEBuilder HiFi Assembly",
      width: 900,
      body: [
        U.section(`Vector: ${name} (${n} bp)`, U.field("Linearize by", linMode.el), h("div", { style: { height: "6px" } }), enzWrap),
        U.section("Inserts (in order)", picker, listBox),
        U.section("Settings", U.row(U.field("Overlap (bp)", overlap), U.field("Target annealing Tm °C", tmT), U.field("Construct name", constructName))),
        out,
      ],
      footer: [
        U.button("Design assembly", design, { intent: "primary", icon: "build" }),
        U.button("Copy primers", wrapTry(() => {
          if (!result) throw new Error("Design the assembly first");
          U.copyText(primersTsv(result.pieces.flatMap((p) => p.primers)), "Primers copied");
        }), { icon: "clipboard" }),
        U.button("Open assembled construct", wrapTry(() => {
          if (!result) throw new Error("Design the assembly first");
          openInNewWindow({ ...result.construct, name: constructName.value || "assembly" });
        }), { icon: "document-open" }),
      ],
    });
  }

  // ---------------------------------------------------------------- gel
  function openGelSimulator() {
    const { seqData } = current();
    const agarose = U.select(Object.keys(D.AGAROSE_RANGES).map((k) => ({ value: k, label: `${k}% agarose` })), "1", { width: 140 });
    const ladder = U.select(Object.keys(D.LADDERS), "GeneRuler 1 kb Plus", { width: 200 });
    const singles = D.COMMON_ENZYMES.filter((e) => {
      try {
        return D.cutPositions(seqData, [e]).length === 1;
      } catch (err) {
        return false;
      }
    });
    const lanes = [
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
      "--",
      { text: "Agarose Gel Simulator…", icon: "timeline-bar-chart", onClick: () => open("gel") },
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
