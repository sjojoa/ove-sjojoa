// Self-contained: upstream extended "teselagen/node", which was never among the
// devDependencies, so `yarn lint` could not run at all on a fresh clone.
//
// Three kinds of file live here and they do not share an environment: the main
// process (CommonJS + Node), the renderer (classic browser scripts, no modules,
// sharing globals through `window`), and the tests (Mocha + Node).
module.exports = {
  root: true,
  parserOptions: { ecmaVersion: 2021, sourceType: "script" },
  env: { es2021: true },
  extends: "eslint:recommended",
  rules: {
    // the renderer leans on hoisting to keep related functions together, and
    // dialog helpers are mutually recursive (close() needs onKey, onKey needs
    // close), which no ordering can satisfy
    "no-use-before-define": ["error", { functions: false, classes: false, variables: false }],
    "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_" }],
    eqeqeq: ["error", "smart"],
    "no-var": "error",
    "prefer-const": ["error", { destructuring: "all" }],
    "no-console": "off",
  },
  overrides: [
    {
      // main process and build scripts
      files: ["main.js", "src/preload.js", "src/main_utils/**", "src/misc/**", "scripts/**"],
      env: { node: true },
    },
    {
      // renderer: plain <script> tags, so everything is shared via window
      files: ["src/**"],
      excludedFiles: ["src/preload.js", "src/main_utils/**", "src/misc/**"],
      env: { browser: true },
      globals: {
        // injected by preload.js
        api: "readonly",
        // the editor bundle and its dependencies
        createVectorEditor: "readonly",
        editor: "writable",
        bioParsers: "readonly",
        sequenceUtils: "readonly",
        // this fork's own modules, each loaded from its own script tag
        dnaTools: "readonly",
        oveTabs: "readonly",
        oveMakeEditor: "readonly",
        oveCdsTranslations: "readonly",
        oveReadThroughColor: "readonly",
        oveFeatureColorField: "readonly",
        oveRenderMismatchNav: "readonly",
        oveLocalAligner: "readonly",
        initialSeqJson: "readonly",
        filePath: "writable",
        // dnaTools is loaded both as a <script> and by the Node tests
        module: "readonly",
        require: "readonly",
      },
    },
    {
      files: ["test/**"],
      env: { node: true, mocha: true },
    },
  ],
};
