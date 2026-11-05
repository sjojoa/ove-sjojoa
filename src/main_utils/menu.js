const { Menu } = require("electron");

const { dialog } = require("electron");

const isMac = process.platform === "darwin";

const recentFiles = require("./recentFiles");
const path = require("path");

module.exports = function createMenu({ createWindow, getSeqJsonFromPath, openPath }) {
  const recent = recentFiles.list();
  // Two files can share a basename, so show the parent folder to tell them apart.
  const labelFor = (p) => {
    const base = path.basename(p);
    const twice = recent.filter((o) => path.basename(o) === base).length > 1;
    return twice ? `${base} — ${path.basename(path.dirname(p))}` : base;
  };
  const openRecentSubmenu = recent.length
    ? [
        ...recent.map((p, i) => ({
          label: labelFor(p),
          toolTip: p,
          accelerator: i < 9 ? `CmdOrCtrl+${i + 1}` : undefined,
          click: () => openPath(p),
        })),
        { type: "separator" },
        { label: "Clear Menu", click: () => { recentFiles.clear(); createMenu({ createWindow, getSeqJsonFromPath, openPath }); } },
      ]
    : [{ label: "No Recent Files", enabled: false }];

  const template = [
    // { role: 'appMenu' }
    ...(isMac
      ? [
          {
            label: "OVE",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideothers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    // { role: 'fileMenu' }
    {
      label: "File",
      submenu: [
        {
          label: "New File",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            createWindow({
              initialSeqJson: undefined,
            });
          },
        },
        {
          label: "Open",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const { filePaths } = await dialog.showOpenDialog({
              filters: [
                {
                  name: "Sequence Files",
                  extensions: [
                    "gb",
                    "json",
                    "dna",
                    "gbk",
                    "gp",
                    "fas",
                    "fasta",
                    "fa",
                    "fna",
                    "ffn",
                    "gff",
                    "gff3",
                    "txt", // the lab's inline-tagged format
                  ],
                },
              ],
              properties: ["openFile", "multiSelections"],
            });

            filePaths.forEach((p) => openPath(p));
          },
        },
        { label: "Open Recent", submenu: openRecentSubmenu },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    // { role: 'editMenu' }
    {
      label: "Edit",
      submenu: [
        // { role: 'undo' },
        // { role: 'redo' },
        // { type: 'separator' },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        {
          // On macOS the standard editing shortcuts only reach a focused text
          // field if a menu item claims the accelerator, so without this Cmd+A
          // does nothing at all in the find box. We can't use { role: "selectAll" }
          // because the sequence editor wants Cmd+A too; the renderer decides
          // which of the two is meant, based on what currently has focus.
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          click: (menuItem, win) => {
            if (win && !win.isDestroyed()) win.webContents.send("ove_selectAll");
          },
        },
        {
          // The find bar's own input swallows Cmd+F (its keydown handler calls
          // preventDefault and then does nothing), and OVE's mod+f hotkey never
          // fires from inside a text field, so pressing Cmd+F a second time was
          // a no-op. An accelerator here is seen before the page gets the key,
          // and the renderer decides: open the find bar, or, if it is already
          // open, select whatever is in it so typing or pasting replaces it.
          label: "Find\u2026",
          accelerator: "CmdOrCtrl+F",
          click: (menuItem, win) => {
            if (win && !win.isDestroyed()) win.webContents.send("ove_find");
          },
        },
        // ...(isMac ? [
        //   { role: 'pasteAndMatchStyle' },
        //   { role: 'delete' },
        //   { role: 'selectAll' },
        //   { type: 'separator' },
        //   {
        //     label: 'Speech',
        //     submenu: [
        //       { role: 'startspeaking' },
        //       { role: 'stopspeaking' }
        //     ]
        //   }
        // ] : [
        //   { role: 'delete' },
        //   { type: 'separator' },
        //   { role: 'selectAll' }
        // ])
      ],
    },
    // { role: 'viewMenu' }
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forcereload" },
        { role: "toggledevtools" },
        { type: "separator" },
        { role: "resetzoom" },
        { role: "zoomin" },
        { role: "zoomout" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    // { role: 'windowMenu' }
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ]
          : [{ role: "close" }]),
      ],
    },
  ];

  // const menu = Menu.buildFromTemplate([
  //   {label: "a", click: }
  // ])
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};
