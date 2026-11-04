# Known issues / to file on GitHub

Tracked here until the repository is published; each entry is written so it can be
pasted into a GitHub issue as-is. Fixed items are removed and described in the README.

---

## 1. `yarn lint` cannot run

`.eslintrc.js` extends `teselagen/node`, but `eslint-config-teselagen` is not among the
devDependencies, so `yarn lint` fails immediately on a fresh clone:

```
ESLint couldn't find the config "teselagen/node" to extend from.
```

Inherited from upstream. Either add the config as a devDependency or replace it with a
self-contained ESLint config. Tests (`yarn test`) are unaffected.
