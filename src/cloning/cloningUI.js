// Minimal DOM toolkit for the Cloning dialogs (Blueprint CSS classes are
// already loaded by OVE, so controls match the rest of the app).
(function () {
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "className") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k in el && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    const add = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }

  function openDialog({ title, width = 760, body, footer, onClose }) {
    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      onClose && onClose();
    };
    const onKey = (e) => e.key === "Escape" && close();
    const overlay = h(
      "div",
      { className: "ove-cl-overlay", onMousedown: (e) => e.target === overlay && close() },
      h(
        "div",
        { className: "ove-cl-dialog bp3-card bp3-elevation-4", style: { width: `${width}px` } },
        h(
          "div",
          { className: "ove-cl-header" },
          h("h4", { className: "bp3-heading" }, title),
          h("button", { className: "bp3-button bp3-minimal bp3-small", title: "Close", onClick: close }, h("span", { className: "bp3-icon-standard bp3-icon-cross" }))
        ),
        h("div", { className: "ove-cl-body" }, body),
        footer ? h("div", { className: "ove-cl-footer" }, footer) : null
      )
    );
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    return { overlay, close };
  }

  const field = (label, control, hint) =>
    h("label", { className: "bp3-label ove-cl-field" }, h("span", { className: "ove-cl-field-label" }, label), control, hint ? h("span", { className: "ove-cl-hint" }, hint) : null);

  const numberInput = (value, { step = 1, min, max, width = 80 } = {}) =>
    h("input", { className: "bp3-input bp3-small", type: "number", value, step, min, max, style: { width: `${width}px` } });

  const textInput = (value = "", { placeholder = "", width = 220, mono } = {}) =>
    h("input", { className: `bp3-input bp3-small${mono ? " ove-cl-mono" : ""}`, type: "text", value, placeholder, style: { width: `${width}px` } });

  const textArea = (value = "", { placeholder = "", rows = 3 } = {}) =>
    h("textarea", { className: "bp3-input bp3-fill ove-cl-mono", rows, placeholder }, value);

  function select(options, value, { width } = {}) {
    const sel = h(
      "select",
      { style: { width: "100%" } },
      options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return h("option", { value: opt.value, selected: opt.value === value }, opt.label);
      })
    );
    return { el: h("div", { className: "bp3-html-select bp3-small", style: width ? { width: `${width}px` } : {} }, sel, h("span", { className: "bp3-icon bp3-icon-standard bp3-icon-double-caret-vertical" })), select: sel };
  }

  const checkbox = (label, checked) => {
    const input = h("input", { type: "checkbox", checked });
    return { el: h("label", { className: "bp3-control bp3-checkbox bp3-inline" }, input, h("span", { className: "bp3-control-indicator" }), label), input };
  };

  const button = (text, onClick, { intent, icon, small = true, minimal, title } = {}) =>
    h(
      "button",
      {
        type: "button",
        title,
        className: ["bp3-button", small && "bp3-small", intent && `bp3-intent-${intent}`, minimal && "bp3-minimal"].filter(Boolean).join(" "),
        onClick,
      },
      icon ? h("span", { className: `bp3-icon-standard bp3-icon-${icon}` }) : null,
      text ? h("span", { className: "bp3-button-text" }, text) : null
    );

  function table(columns, rows, { onSelect, selectedIndex = -1 } = {}) {
    let selected = selectedIndex;
    const tbody = h("tbody");
    const render = () => {
      tbody.innerHTML = "";
      rows.forEach((row, i) => {
        tbody.appendChild(
          h(
            "tr",
            {
              className: i === selected ? "ove-cl-selected" : "",
              onClick: () => {
                if (!onSelect) return;
                selected = i;
                render();
                onSelect(row, i);
              },
              style: onSelect ? { cursor: "pointer" } : {},
            },
            columns.map((c) => h("td", { className: c.className || "" }, c.render(row, i)))
          )
        );
      });
    };
    render();
    return h(
      "div",
      { className: "ove-cl-table-wrap" },
      h("table", { className: "bp3-html-table bp3-html-table-condensed bp3-html-table-striped bp3-small ove-cl-table" }, h("thead", {}, h("tr", {}, columns.map((c) => h("th", {}, c.title)))), tbody)
    );
  }

  const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : "–");
  const toast = (msg, type = "success") => window.toastr && window.toastr[type] && window.toastr[type](msg);
  async function copyText(text, what = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} to clipboard`);
    } catch (e) {
      toast(`Could not copy: ${e.message}`, "error");
    }
  }
  // tail lowercase + annealing uppercase, for primer display
  const primerSpan = (tail, anneal) => h("span", { className: "ove-cl-mono" }, h("span", { className: "ove-cl-tail" }, (tail || "").toLowerCase()), anneal.toUpperCase());
  const warnList = (warnings) =>
    warnings && warnings.length ? h("span", { className: "ove-cl-warn", title: warnings.join("\n") }, `⚠ ${warnings.length}`) : h("span", { className: "ove-cl-ok" }, "✓");
  const section = (title, ...content) => h("div", { className: "ove-cl-section" }, title ? h("h5", { className: "bp3-heading" }, title) : null, ...content);
  const row = (...children) => h("div", { className: "ove-cl-row" }, ...children);
  const callout = (text, intent = "primary") => h("div", { className: `bp3-callout bp3-intent-${intent} ove-cl-callout` }, text);

  window.oveCloningUI = { h, openDialog, field, numberInput, textInput, textArea, select, checkbox, button, table, fmt, toast, copyText, primerSpan, warnList, section, row, callout };
})();
