// Document tabs: one window holds many sequences, like browser tabs.
// A tab can be dragged out to become its own window, and dragged back onto
// another window's tab strip. The main process does the cross-window part,
// because drag events never leave the window they started in.
(function () {
  const DRAG_START_PX = 5; // pointer slop before a click counts as a drag
  const TEAR_OFF_PX = 45; // how far below/above the strip means "pull out"

  let counter = 0;
  const docs = [];
  let activeId = null;
  let strip, docsHolder, dragHint;

  const docById = (id) => docs.find((d) => d.id === id);
  const getActive = () => docById(activeId);

  function buildChrome() {
    document.body.classList.add("ove-has-tabs");
    strip = document.createElement("div");
    strip.id = "ove-tabstrip";
    docsHolder = document.createElement("div");
    docsHolder.id = "ove-docs";
    document.body.insertBefore(strip, document.body.firstChild);
    document.body.insertBefore(docsHolder, strip.nextSibling);

    // the dark-mode button lived in the top-right of the page; park it in the strip
    const darkBtn = document.querySelector(".darkModeBtn");
    if (darkBtn) {
      darkBtn.classList.add("ove-in-strip");
      strip.appendChild(darkBtn);
    }

    dragHint = document.createElement("div");
    dragHint.id = "ove-drag-hint";
    dragHint.textContent = "Release to open in a new window";
    document.body.appendChild(dragHint);
  }

  // ---------------------------------------------------------------- render
  function renderStrip() {
    [...strip.querySelectorAll(".ove-tab")].forEach((el) => el.remove());
    const darkBtn = strip.querySelector(".darkModeBtn");
    docs.forEach((doc) => {
      const tab = document.createElement("div");
      tab.className = "ove-tab" + (doc.id === activeId ? " ove-tab-active" : "");
      tab.title = doc.filePath || doc.name;
      tab.dataset.id = doc.id;

      const label = document.createElement("span");
      label.className = "ove-tab-name";
      label.textContent = doc.name;
      tab.appendChild(label);

      const close = document.createElement("button");
      close.className = "ove-tab-close";
      close.title = "Close tab";
      close.textContent = "×";
      close.addEventListener("pointerdown", (e) => e.stopPropagation());
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeDoc(doc.id);
      });
      tab.appendChild(close);

      tab.addEventListener("pointerdown", (e) => onTabPointerDown(e, doc, tab));
      tab.addEventListener("auxclick", (e) => {
        if (e.button === 1) closeDoc(doc.id); // middle-click closes
      });
      tab.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        window.api.send("ove_tabContextMenu", { docId: doc.id, payload: serialize(doc) });
      });
      strip.insertBefore(tab, darkBtn || null);
    });
  }

  function activate(id) {
    const doc = docById(id);
    if (!doc) return;
    activeId = id;
    docs.forEach((d) => d.container.classList.toggle("ove-doc-active", d.id === id));
    window.oveSetWindowTitle(doc.name);
    renderStrip();
    scheduleMount();
  }

  // An editor is built the first time its tab is shown, and always in its own
  // tick: mounting two of them inside one React update re-enters the shared
  // store and throws "maximum update depth exceeded". Opening several files at
  // once therefore only builds the one that ends up in front.
  // Only the visible tab has a live editor. Two OVE editors mounted at once
  // fight over the single shared redux store and one of them tears the other
  // down, so a hidden tab is unmounted instead. Its state (panels, selection,
  // undo history) stays in the store under its own editorName, and its
  // sequence is kept here, so showing it again restores what you had.
  let mountTimer = null;

  function unmount(doc) {
    if (!doc.editor) return;
    try {
      doc.seqJson = JSON.parse(JSON.stringify(doc.editor.getState().sequenceData));
    } catch (e) {
      /* keep the previous snapshot */
    }
    try {
      doc.editor.close(); // also detaches the container, so make a fresh one
    } catch (e) {
      /* already gone */
    }
    doc.editor = null;
    const fresh = document.createElement("div");
    fresh.className = doc.container.className;
    docsHolder.appendChild(fresh);
    doc.container = fresh;
    doc.hasMounted = true;
  }

  function scheduleMount() {
    if (mountTimer) return;
    mountTimer = setTimeout(() => {
      mountTimer = null;
      const doc = getActive();
      if (!doc) return;
      docs.forEach((d) => {
        if (d !== doc) unmount(d);
      });
      doc.container.classList.add("ove-doc-active");
      if (!doc.editor) {
        try {
          window.oveMakeEditor(doc.container, doc, doc.hasMounted);
        } catch (e) {
          console.error("could not open this sequence:", e);
          window.toastr && window.toastr.error(`Could not open "${doc.name}"`);
          return;
        }
      }
      window.editor = doc.editor; // the alignment + cloning code reads this
      window.oveActiveEditorName = doc.editorName;
      if (window.oveCloning) window.oveCloning.setEditor(doc.editor);
    }, 0);
  }

  // ------------------------------------------------------------- doc list
  function nameFor(seqJson, filePath) {
    if (filePath) return filePath.slice(filePath.lastIndexOf("/") + 1);
    return (seqJson && seqJson.name) || "Untitled Sequence";
  }

  function addDoc({ seqJson, filePath, activate: makeActive = true }) {
    const id = `doc${++counter}`;
    const container = document.createElement("div");
    container.className = "ove-doc";
    docsHolder.appendChild(container);
    const doc = {
      id,
      editorName: `OveEditor_${id}`,
      name: nameFor(seqJson, filePath),
      filePath: filePath || undefined,
      seqJson: seqJson || { circular: true },
      container,
      editor: null,
    };
    docs.push(doc);
    if (makeActive || docs.length === 1) activate(id);
    else renderStrip();
    return doc;
  }

  function closeDoc(id) {
    const i = docs.findIndex((d) => d.id === id);
    if (i === -1) return;
    const [doc] = docs.splice(i, 1);
    try {
      if (doc.editor && doc.editor.close) doc.editor.close();
    } catch (e) {
      /* already gone */
    }
    doc.container.remove();
    if (!docs.length) {
      window.api.send("ove_closeThisWindow"); // last tab closed: close the window
      return;
    }
    activate(docs[Math.min(i, docs.length - 1)].id);
  }

  function renameDoc(id, name) {
    const doc = docById(id);
    if (!doc || !name) return;
    doc.name = name;
    if (id === activeId) window.oveSetWindowTitle(name);
    renderStrip();
  }

  // everything another window needs to re-create this tab
  function serialize(doc) {
    const sd = doc.editor ? doc.editor.getState().sequenceData : doc.seqJson;
    return {
      seqJson: JSON.parse(JSON.stringify(sd)),
      filePath: doc.filePath,
      name: doc.name,
    };
  }

  // --------------------------------------------------------------- drag
  let drag = null;

  function onTabPointerDown(e, doc, tab) {
    if (e.button !== 0) return;
    activate(doc.id);
    // pointer capture keeps the move/up events coming even outside the window
    try {
      tab.setPointerCapture(e.pointerId);
    } catch (err) {
      /* some pointer ids cannot be captured; the window listeners still fire */
    }
    drag = {
      doc,
      tab,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      torn: false,
    };
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
    drag.moved = true;
    drag.tab.classList.add("ove-tab-dragging");

    const stripBox = strip.getBoundingClientRect();
    const outside =
      e.clientY > stripBox.bottom + TEAR_OFF_PX ||
      e.clientY < stripBox.top - TEAR_OFF_PX ||
      e.clientX < -TEAR_OFF_PX ||
      e.clientX > window.innerWidth + TEAR_OFF_PX;

    if (outside) {
      drag.torn = true;
      dragHint.classList.add("ove-visible");
      dragHint.textContent =
        docs.length > 1
          ? "Release to open in a new window (or drop on another window)"
          : "Release over another window to move this tab there";
    } else {
      drag.torn = false;
      dragHint.classList.remove("ove-visible");
      reorderTo(e.clientX);
    }
  }

  // live reorder inside the strip
  function reorderTo(clientX) {
    const others = docs.filter((d) => d.id !== drag.doc.id);
    const tabs = [...strip.querySelectorAll(".ove-tab")].filter(
      (t) => t.dataset.id !== drag.doc.id
    );
    let insertAt = others.length;
    for (let i = 0; i < tabs.length; i++) {
      const box = tabs[i].getBoundingClientRect();
      if (clientX < box.left + box.width / 2) {
        insertAt = i;
        break;
      }
    }
    const from = docs.indexOf(drag.doc);
    const target = insertAt >= from ? insertAt : insertAt;
    if (docs.indexOf(drag.doc) === target) return;
    docs.splice(from, 1);
    docs.splice(target, 0, drag.doc);
    renderStrip();
    // renderStrip replaced the element, so keep dragging the new one
    const fresh = strip.querySelector(`.ove-tab[data-id="${drag.doc.id}"]`);
    if (fresh) {
      fresh.classList.add("ove-tab-dragging");
      drag.tab = fresh;
    }
  }

  async function onPointerUp(e) {
    if (!drag) return;
    const current = drag;
    drag = null;
    dragHint.classList.remove("ove-visible");
    current.tab.classList.remove("ove-tab-dragging");
    try {
      current.tab.releasePointerCapture(current.pointerId);
    } catch (err) {
      /* capture already lost */
    }
    if (!current.moved || !current.torn) return;

    // main decides: another window under the cursor, or a brand new one
    const res = await window.api.send("ove_tabDropped", {
      screenX: e.screenX,
      screenY: e.screenY,
      payload: serialize(current.doc),
      isOnlyTab: docs.length === 1,
    });
    if (res && res.accepted) closeDoc(current.doc.id);
  }

  // --------------------------------------------------- select all (Cmd+A)
  // Routed here from the Edit menu. A focused text field gets its own text
  // selected (what every other app does); otherwise the whole sequence of the
  // active tab is selected, which is what the editor's own Select All does.
  function selectAll() {
    const el = document.activeElement;
    // OVE keeps offscreen <input class="clipboard"> elements around for copy
    // and paste, so a field only counts if it is one the user can actually see
    // and type into.
    const TEXTY = ["text", "search", "url", "tel", "email", "password", "number", ""];
    const visible = el && el.offsetParent !== null;
    const isField =
      visible &&
      !el.classList.contains("clipboard") &&
      ((el.tagName === "INPUT" && TEXTY.includes((el.type || "").toLowerCase())) ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable);
    if (isField) {
      if (typeof el.select === "function") el.select();
      else document.getSelection().selectAllChildren(el);
      return;
    }
    const doc = getActive();
    if (!doc || !doc.editor) return;
    const state = doc.editor.getState();
    const length = ((state.sequenceData || {}).sequence || "").length;
    if (length) doc.editor.updateEditor({ selectionLayer: { start: 0, end: length - 1 } });
  }

  // --------------------------------------------------------------- setup
  function init(first) {
    buildChrome();
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);

    window.api.on("ove_addTab", (payload) => {
      addDoc({ seqJson: payload.seqJson, filePath: payload.filePath });
      window.api.send("ove_focusThisWindow");
    });
    window.api.on("ove_closeTab", ({ docId }) => closeDoc(docId));
    window.api.on("ove_selectAll", selectAll);

    addDoc(first);
    // tell the main process it is safe to push tabs to this window now
    window.api.send("ove_rendererReady");
  }

  window.oveTabs = {
    init,
    selectAll,
    addDoc,
    closeDoc,
    renameDoc,
    activate,
    getActive,
    serialize,
    docs,
  };
})();
