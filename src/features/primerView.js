// The primer hybridisation view: one panel, used everywhere a primer's bases
// are entered.
//
// The primer's sequence is the control. Type a base onto the 3' end or trim
// one off the 5' end and the binding sites, the per-base pairing and the
// annealing temperature all follow — which is how primers are actually edited,
// rather than by retyping a finished oligo into a dialog. Three states are
// kept visually distinct on purpose: paired, mispaired, and 5' tail. A tail is
// not an error, and a panel that reddens one makes a perfectly good cloning
// primer look broken.
//
// Pure placement lives in features/primerHybridization.js; this is the view
// over it, plus the parameters that decide which sites it reports.
(function () {
  const H = () => window.ovePrimerHybridization;
  const ui = () => window.oveCloningUI;
  const STORE_KEY = "ove.primerParams";

  // ------------------------------------------------------------- parameters
  // Per sequence, from a default set that newly opened files start with. The
  // defaults outlive the window; a sequence's own overrides do not, because
  // they belong to the primer being worked on rather than to the file.
  const perDoc = new Map();

  function defaults() {
    const base = Object.assign({}, H().DEFAULT_PARAMS);
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || "{}");
      Object.keys(base).forEach((k) => {
        if (saved[k] !== undefined && typeof saved[k] === typeof base[k]) base[k] = saved[k];
      });
    } catch (e) {
      /* no stored defaults, or storage unavailable */
    }
    return base;
  }

  function paramsFor(docKey) {
    if (!perDoc.has(docKey)) perDoc.set(docKey, defaults());
    return perDoc.get(docKey);
  }

  function saveDefaults(params) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(params));
    } catch (e) {
      /* storage unavailable; the current window still has them */
    }
  }

  // ----------------------------------------------------------------- pieces
  const oneBased = (n) => n + 1;

  function goToSite(site) {
    const doc = window.oveTabs && window.oveTabs.getActive();
    if (!doc || !doc.editor) return;
    doc.editor.updateEditor({
      selectionLayer: { start: site.start, end: site.end, forceUpdate: Date.now() },
      caretPosition: -1,
    });
  }

  // The three-line alignment. Laid out in the primer's own 5'→3' order, so the
  // template line always reads 3'→5' left to right — including for a primer on
  // the bottom strand, which runs right-to-left on the map.
  //
  // The template is drawn under the 5' tail too, greyed: those bases are what
  // the tail is sitting over and not pairing with, which is the whole point of
  // telling a tail apart from a mismatch.
  function alignmentBlock(site, primer, template, isCircular) {
    const { h } = ui();
    const rows = H().alignment(site, primer, template);
    const seq = String(template || "").toUpperCase();
    const n = seq.length;
    const CONTEXT = 8;
    const len = rows.length;

    // Template index under a given column, counted in primer coordinates:
    // `i` is the primer position (negative to the 5' side, >= len to the 3').
    const anchor = site.fivePrimeOnly
      ? site.bottomStrand
        ? site.end
        : site.start
      : site.threePrimeEnd;
    const indexAt = (i) => {
      if (!n) return null;
      const stepsFromAnchor = site.fivePrimeOnly ? i : i - (len - 1);
      const raw = anchor + (site.bottomStrand ? -stepsFromAnchor : stepsFromAnchor);
      if (raw < 0 || raw >= n) {
        if (!isCircular) return null;
        return ((raw % n) + n) % n;
      }
      return raw;
    };
    // the base on the strand the primer anneals to
    const partnerAt = (i) => {
      const idx = indexAt(i);
      if (idx === null) return null;
      return (site.bottomStrand ? seq[idx] : complementOf(seq[idx])).toUpperCase();
    };

    const span = (text, cls) => h("span", { className: cls }, text);
    const columns = [];
    for (let i = -CONTEXT; i < len + CONTEXT; i++) {
      const row = i >= 0 && i < len ? rows[i] : null;
      columns.push({
        i,
        base: row ? row.base : null,
        state: row ? row.state : "context",
        partner: partnerAt(i),
      });
    }

    const primerLine = h(
      "div",
      { className: "ove-ph-line" },
      span("5′ ", "ove-ph-end"),
      columns.map((c) =>
        span(
          c.base || " ",
          c.state === "tail" ? "ove-ph-tail" : c.state === "mismatch" ? "ove-ph-bad" : c.state === "match" ? "ove-ph-good" : ""
        )
      ),
      span(" 3′", "ove-ph-end")
    );
    const bars = h(
      "div",
      { className: "ove-ph-line ove-ph-bars" },
      span("   ", ""),
      columns.map((c) => span(c.state === "match" ? "|" : c.state === "mismatch" ? "×" : " ", c.state === "mismatch" ? "ove-ph-bad" : ""))
    );
    const templateLine = h(
      "div",
      { className: "ove-ph-line" },
      span("3′ ", "ove-ph-end"),
      columns.map((c) =>
        span(
          c.partner || " ",
          c.state === "mismatch" ? "ove-ph-bad" : c.state === "match" ? "ove-ph-template" : "ove-ph-context"
        )
      ),
      span(" 5′", "ove-ph-end")
    );

    const strandNote = site.bottomStrand
      ? `template ${oneBased(site.end)} → ${oneBased(site.start)} · bottom-strand primer, so it reads right-to-left on the map`
      : `template ${oneBased(site.start)} → ${oneBased(site.end)} · top strand`;

    return h(
      "div",
      { className: "ove-ph-align" },
      h("div", { className: "ove-ph-alignscroll" }, primerLine, bars, templateLine),
      h("div", { className: "ove-ph-strandnote" }, strandNote)
    );
  }

  const COMP = { A: "T", T: "A", G: "C", C: "G", N: "N", R: "Y", Y: "R", K: "M", M: "K", S: "S", W: "W", B: "V", V: "B", D: "H", H: "D" };
  const complementOf = (b) => COMP[String(b || "").toUpperCase()] || b;

  // ------------------------------------------------------------------- view
  // { el, getBases, setBases, getSite, getSites, refresh, setTemplate }
  function create(options) {
    const opts = options || {};
    const U = ui();
    const { h, button, checkbox, numberInput } = U;
    let bases = opts.bases || "";
    let activeIndex = 0;
    let result = { sites: [], reason: null };
    let timer = null;

    const docKey = opts.docKey || "default";
    let params = paramsFor(docKey);

    const input = h("textarea", {
      className: "bp3-input bp3-fill ove-cl-mono ove-ph-input",
      rows: opts.rows || 2,
      spellcheck: false,
      placeholder: opts.placeholder || "Primer bases, 5′→3′ (a 5′ tail is fine)",
    });
    input.value = bases;

    const stats = h("div", { className: "ove-ph-stats" });
    const alignHost = h("div", {});
    const sitesHost = h("div", { className: "ove-ph-sites" });
    const message = h("div", {});

    // -------------------------------------------------- parameters panel
    const min3 = numberInput(params.minMatch3Prime, { min: 6, max: 60, width: 64 });
    const isolated = checkbox(" Allow a single isolated mismatch", params.allowIsolatedMismatch);
    const minTm = numberInput(params.minTm, { min: 0, max: 90, width: 64 });
    const only5 = checkbox(" Also show sites that pair at the 5′ end only", params.show5PrimeOnly);
    const min5 = numberInput(params.minMatch5Prime, { min: 6, max: 60, width: 64 });

    function readParams() {
      params = {
        minMatch3Prime: Math.max(2, +min3.value || H().DEFAULT_PARAMS.minMatch3Prime),
        allowIsolatedMismatch: !!isolated.input.checked,
        minTm: Math.max(0, +minTm.value || 0),
        show5PrimeOnly: !!only5.input.checked,
        minMatch5Prime: Math.max(2, +min5.value || H().DEFAULT_PARAMS.minMatch5Prime),
      };
      perDoc.set(docKey, params);
      min5.disabled = !params.show5PrimeOnly;
      compute();
    }
    [min3, minTm, min5].forEach((el) => el.addEventListener("change", readParams));
    [isolated.input, only5.input].forEach((el) => el.addEventListener("change", readParams));

    function writeParams(next) {
      min3.value = next.minMatch3Prime;
      isolated.input.checked = next.allowIsolatedMismatch;
      minTm.value = next.minTm;
      only5.input.checked = next.show5PrimeOnly;
      min5.value = next.minMatch5Prime;
      readParams();
    }

    const paramsPanel = h(
      "div",
      { className: "ove-ph-params", style: { display: "none" } },
      h(
        "div",
        { className: "ove-ph-param-row" },
        min3,
        h("span", {}, "bases at the 3′ end must pair"),
        h("span", { className: "ove-cl-hint" }, "the end a polymerase extends from")
      ),
      h("div", { className: "ove-ph-param-row" }, isolated.el, h("span", { className: "ove-cl-hint" }, "one mismatch 5′ of that, with pairing bases either side")),
      h(
        "div",
        { className: "ove-ph-param-row" },
        minTm,
        h("span", {}, "°C minimum melting temperature of the paired stretch")
      ),
      h("div", { className: "ove-ph-param-row" }, only5.el),
      h(
        "div",
        { className: "ove-ph-param-row" },
        min5,
        h("span", {}, "bases at the 5′ end, for those"),
        h("span", { className: "ove-cl-hint" }, "no product comes off them")
      ),
      h(
        "div",
        { className: "ove-ph-param-row" },
        button("Reset", () => writeParams(defaults()), { minimal: true }),
        button(
          "Use as default for new files",
          () => {
            saveDefaults(params);
            U.toast("Saved as the default hybridisation parameters");
          },
          { minimal: true, icon: "floppy-disk" }
        )
      )
    );
    const paramsToggle = button(
      "Parameters",
      () => {
        const open = paramsPanel.style.display === "none";
        paramsPanel.style.display = open ? "" : "none";
        paramsToggle.classList.toggle("bp3-active", open);
      },
      { minimal: true, icon: "cog", title: "Which binding sites are reported" }
    );

    // ------------------------------------------------------------ actions
    function setBases(next, { silent } = {}) {
      bases = next || "";
      input.value = bases;
      activeIndex = 0;
      if (!silent) compute();
    }

    const flip = () => {
      const clean = String(input.value || "").replace(/[^A-Za-z]/g, "");
      if (!clean) return;
      setBases(H().reverseComplement(clean));
      input.focus();
    };

    // ------------------------------------------------------------ render
    function template() {
      return (typeof opts.template === "function" ? opts.template() : opts.template) || "";
    }
    function isCircular() {
      return !!(typeof opts.isCircular === "function" ? opts.isCircular() : opts.isCircular);
    }

    function renderStats() {
      const D = window.dnaTools;
      const clean = String(input.value || "").replace(/[^A-Za-z]/g, "");
      stats.innerHTML = "";
      if (!clean.length) return;
      const site = result.sites[activeIndex];
      const chips = [`${clean.length} nt`];
      if (D) chips.push(`${D.gcPercent(clean).toFixed(0)} % GC`);
      if (site) {
        // the Tm is the nearest-neighbour Tm of the paired stretch taken as a
        // perfect duplex, so a site with a mismatch in it reads high: say so
        // rather than quoting a number that looks exact
        chips.push(
          `Tm ${Number.isFinite(site.tm) ? site.tm.toFixed(1) : "–"} °C` +
            (site.mismatchCount
              ? " (as if perfectly paired)"
              : site.tailLength
              ? " (paired stretch)"
              : "")
        );
        // on a 5'-anchored site the unpaired stretch hangs off the 3' end,
        // which is the end that matters: say which end it is
        if (site.tailLength) {
          chips.push(`${site.tailLength} nt ${site.fivePrimeOnly ? "3′" : "5′"} tail`);
        }
      } else if (D) {
        const t = D.tm(clean);
        if (Number.isFinite(t)) chips.push(`Tm ${t.toFixed(1)} °C (whole oligo)`);
      }
      chips.forEach((c) => stats.appendChild(h("span", { className: "ove-ph-chip" }, c)));
    }

    function renderSites() {
      const { table } = U;
      sitesHost.innerHTML = "";
      alignHost.innerHTML = "";
      message.innerHTML = "";
      const clean = String(input.value || "").replace(/[^A-Za-z]/g, "");
      if (!clean) return;
      if (!result.sites.length) {
        message.appendChild(U.callout(result.reason || "No binding site.", "warning"));
        const note = typeof opts.noSiteNote === "function" ? opts.noSiteNote() : null;
        if (note) message.appendChild(U.callout(note, "warning"));
        // The commonest reason a real primer finds nothing is that its 3' end
        // does not pair — a primer designed against a different template, or
        // a mutagenic one. That site is worth naming even though no product
        // comes off it, rather than leaving "no binding site" as the whole
        // story behind a parameter nobody has turned on.
        if (!params.show5PrimeOnly) {
          const probe = H().findSites(template(), clean, {
            isCircular: isCircular(),
            params: Object.assign({}, params, { show5PrimeOnly: true }),
          });
          const best = probe.sites[0];
          if (best) {
            message.appendChild(
              U.callout(
                h(
                  "div",
                  {},
                  h(
                    "div",
                    {},
                    `${best.annealLength} bases do pair, at ${oneBased(best.start)}–${oneBased(best.end)} on the ` +
                      `${best.bottomStrand ? "bottom" : "top"} strand, but the 3′ end does not — so nothing extends from here.`
                  ),
                  button(
                    "Show 5′-end-only sites",
                    () => writeParams(Object.assign({}, params, { show5PrimeOnly: true })),
                    { minimal: true, icon: "eye-open" }
                  )
                ),
                "primary"
              )
            );
          }
        }
        return;
      }
      if (activeIndex >= result.sites.length) activeIndex = 0;
      const site = result.sites[activeIndex];

      alignHost.appendChild(alignmentBlock(site, clean, template(), isCircular()));

      const count = result.sites.length;
      // One site needs a sentence, not a table with a single row in it —
      // which matters most inside the Add/Edit Primer dialog, where every
      // row of chrome pushes the alignment below the fold.
      if (count === 1) {
        sitesHost.appendChild(
          h(
            "div",
            { className: "ove-ph-siteshead" },
            `One binding site: ${oneBased(site.start)}–${oneBased(site.end)}, ` +
              `${site.bottomStrand ? "bottom" : "top"} strand, ` +
              `${site.annealLength} nt pairing` +
              (site.mismatchCount ? `, ${site.mismatchCount} mismatch${site.mismatchCount > 1 ? "es" : ""}` : "") +
              (site.fivePrimeOnly ? ", 3′ end unpaired" : ""),
            button("Go to", () => goToSite(site), {
              minimal: true,
              icon: "locate",
              title: "Select this site in the editor",
            })
          )
        );
        return;
      }
      sitesHost.appendChild(
        h(
          "div",
          { className: "ove-ph-siteshead" },
          `${count} binding sites, best first`,
          h("span", { className: "ove-cl-hint" }, " — click one to show it, or go to it on the map")
        )
      );
      sitesHost.appendChild(
        table(
          [
            { title: "Position", render: (r) => `${oneBased(r.start)}–${oneBased(r.end)}` },
            { title: "Strand", render: (r) => (r.bottomStrand ? "bottom (←)" : "top (→)") },
            { title: "Pairs", render: (r) => `${r.annealLength} nt${r.tailLength ? ` + ${r.tailLength} tail` : ""}` },
            {
              title: "Mismatches",
              render: (r) =>
                r.fivePrimeOnly
                  ? h("span", { className: "ove-cl-warn" }, "3′ end unpaired")
                  : r.mismatchCount
                  ? h("span", { className: "ove-cl-warn" }, String(r.mismatchCount))
                  : h("span", { className: "ove-cl-ok" }, "0"),
            },
            {
              title: "Tm",
              render: (r) =>
                Number.isFinite(r.tm) ? `${r.mismatchCount ? "~" : ""}${r.tm.toFixed(1)} °C` : "–",
            },
            {
              title: "",
              render: (r) =>
                button("Go to", () => goToSite(r), { minimal: true, icon: "locate", title: "Select this site in the editor" }),
            },
          ],
          result.sites,
          {
            selectedIndex: activeIndex,
            onSelect: (row, i) => {
              activeIndex = i;
              renderStats();
              renderSites();
              notifySite();
            },
          }
        )
      );
      if (!result.sites[0].fivePrimeOnly) {
        sitesHost.appendChild(
          U.callout("More than one site: this primer can prime in several places, which is the usual reason for extra bands.", "warning")
        );
      }
    }

    // Hosts that mirror the chosen site somewhere else — the Add/Edit Primer
    // dialog writes it onto the annotation — need telling when it changes,
    // whether that was a new search or a different row being clicked.
    function notifySite() {
      if (opts.onSite) opts.onSite(result.sites[activeIndex] || null, result);
    }

    function compute() {
      const clean = String(input.value || "").replace(/[^A-Za-z]/g, "");
      bases = input.value;
      result = clean
        ? H().findSites(template(), clean, { isCircular: isCircular(), params })
        : { sites: [], reason: null };
      renderStats();
      renderSites();
      if (opts.onChange) opts.onChange(result, clean);
      notifySite();
    }

    input.addEventListener("input", () => {
      // debounced, so a long paste or a held-down key does not re-scan the
      // whole plasmid on every intermediate value
      window.clearTimeout(timer);
      timer = window.setTimeout(compute, 120);
    });

    const extraButtons = (opts.buttons || []).map((b) =>
      button(b.text, () => b.onClick(result.sites[activeIndex] || null, String(input.value || "").replace(/[^A-Za-z]/g, "")), b)
    );

    const el = h(
      "div",
      { className: `ove-ph${opts.compact ? " ove-ph-compact" : ""}` },
      opts.showInput === false ? null : input,
      // the verdict comes before the numbers: a panel headed "where this
      // primer binds" has to lead with "it doesn't" when it doesn't
      message,
      h(
        "div",
        { className: "ove-cl-row ove-ph-toolbar" },
        button("Reverse complement", flip, { icon: "swap-horizontal", title: "Replace the sequence with its reverse complement" }),
        paramsToggle,
        extraButtons,
        stats
      ),
      paramsPanel,
      alignHost,
      sitesHost
    );

    min5.disabled = !params.show5PrimeOnly;
    if (bases) compute();

    return {
      el,
      input,
      getBases: () => String(input.value || "").replace(/[^A-Za-z]/g, ""),
      setBases,
      getSite: () => result.sites[activeIndex] || null,
      getSites: () => result.sites,
      getResult: () => result,
      refresh: compute,
      // re-draw from the sites already found, for when something outside the
      // sequence changed (the annotation's coordinates, say) and rescanning
      // the template would be wasted work
      redraw: () => {
        renderStats();
        renderSites();
      },
      focus: () => input.focus(),
    };
  }

  window.ovePrimerView = { create, defaults, paramsFor, goToSite };
})();
