# Archive — kolnovel v1 (pre-starless)

Frozen snapshot of the original `site:kolnovel` v1.10.0 extension, hidden since the
kolnovel.com starless-theme redesign broke all its selectors.

- Excluded from `npm run build` (only `extensions/*.js` is indexed) and from
  `npm test` (see `exclude` in `vitest.config.mjs`).
- Display name inside is `كول نوفيل اولد` so it can never be confused with the live one.
- To restore: `git mv archive/kolnovel-v1/site.kolnovel.js extensions/` (+ tests/fixtures),
  revert the name, and rebuild with `--sign`.
