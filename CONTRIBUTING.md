# Contributing

Thanks for looking. A few ground rules keep this project small and useful.

**One file.** `index.html` is the whole app: inline CSS, inline vanilla JS,
no build step, no framework, nothing fetched at runtime. Please keep it that
way.

**Tests run in a real browser.** `npm test` drives the actual file with
Playwright and a frozen clock. Add or update a test when you change behaviour;
the suites are in `tests/` and share `tests/_harness.js`. Put a new suite in
its own `*.test.js` and it is picked up automatically.

**No personal data in the repo.** The seed data is deliberately generic
(Alex, Sam, round-number bills). Don't commit a real export — `*.json` is
gitignored for that reason.

**Data format changes** must be backward compatible: `normalize()` in
`index.html` fills missing fields with defaults, and old exports must still
import. Document the change in `docs/data-format.md`.

**Style.** ES5-flavoured JS on purpose (it runs in anything, it's easy to read
in one sitting). Two-space indent. Currency through `Intl.NumberFormat`,
never string concatenation.

Open an issue before a large change so we can agree on the shape first.
