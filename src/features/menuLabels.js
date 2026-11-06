// Renaming upstream menu entries that do not say what they do in the terms
// this lab uses.
//
// "Rotate To Caret Position" is how OVE describes setting a circular
// sequence's origin: it rotates the sequence so the caret becomes base 1.
// That is "set the origin" in every plasmid map and every conversation about
// one, so it is labelled that way here. Only the label changes — same command,
// same Cmd+B.
(function () {
  const RENAMES = { rotateToCaretPosition: "Set Origin" };

  // a menu entry is either the command's name as a string, or an object with
  // a cmd; an explicit text on the object wins over the command's own name
  const rename = (item) => {
    if (typeof item === "string" && RENAMES[item]) {
      return { cmd: item, text: RENAMES[item] };
    }
    if (item && item.cmd && RENAMES[item.cmd] && !item.text) {
      return Object.assign({}, item, { text: RENAMES[item.cmd] });
    }
    return item;
  };

  const renameAll = (items) => (Array.isArray(items) ? items.map(rename) : items);

  function menuFilter(menu) {
    return menu.map((top) =>
      top && Array.isArray(top.submenu)
        ? Object.assign({}, top, { submenu: renameAll(top.submenu) })
        : top
    );
  }

  // the caret's own context menu carries the same command
  const rightClickOverrides = {
    backgroundRightClicked: (items) => {
      const next = renameAll(items);
      // the array the editor hands over carries the triggering event on it
      if (items && items._event) next._event = items._event;
      return next;
    },
  };

  window.oveMenuLabels = { menuFilter, rightClickOverrides, RENAMES };
})();
