# Machloket

the owner's Discord-like web client for her Spacebar instance. Machloket (מחלוקת, "discord") is a private fork of **Fermo** (AGPL-3.0, vanilla TypeScript + Vite), forked at `371e601`.

## Hard constraints

- **Never contribute upstream.** Fermo's README bans any AI use in its repo: no PRs, issues or contact with its maintainer. `upstream` (`https://git.sovrahi.com/oh64/Fermo.git`) is fetch-only; its push URL is disabled on purpose. Agent fetch tools get a Cloudflare 403 there; plain `git`/`curl` work.
- **Licence:** keep the AGPL notices (`LICENSE`, author credits). Users are offered source through the private-repo link.
- **Donor code** may come from Fuzzy (`~/Projects/spacebar-clients/fuzzy`, AGPL-3.0; the look-and-feel reference) and Flicker (`~/Projects/spacebar-clients/flicker`, GPL-3.0). Refactor donor code freely.
- **Parity bar:** someone switching from Discord should have "minimal headache": same layout, interaction patterns and shortcuts. Decompiling Discord's client is out.
- **Server-side questions** (Web Push, instance config, gateway, interaction routes) belong to the "Spacebar server fork" session (`~/Projects/spacebar-server`). Don't restart the instance on :3001 or the LAN test stack that session runs.
- `~/Projects/spacebar-clients/fermo` is the server session's survey clone. Work here, not there.

## Commands

Node 24 (mise), npm (the repo ships `package-lock.json`; don't switch it to pnpm).

| What                               | Command                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| Install                            | `npm ci`                                                    |
| Type check                         | `npm run check`                                             |
| Tests (headless Chromium)          | `npm test`                                                  |
| Production build → `dist/webpage/` | `npm run build`                                             |
| Dev server                         | `npx vite --port 8080` (add `--host 0.0.0.0` for the phone) |

- **The gate before every commit:** `npm run check && npm test && npm run build`.
- Tests are Vitest in browser mode (`vite.config.js` → `test`). The app's modules import each other in cycles that only evaluate correctly under native browser ESM; Vitest's default module runner (tried with happy-dom) fails at import. A test imports `./localuser` before anything else, in the entry's order (see `src/webpage/instancePicker.test.ts`). `src/webpage/test/setup.ts` answers instance discovery in memory (`addInstance`, `acceptLogins`); other same-origin requests reach the Vitest server. First run on a new machine: `npx playwright install chromium`.
- The instance list is only `src/webpage/public/instances.json` (upstream's Spacebar Explorer catalog is gone). `{hostname}` in a `url` is replaced with the host serving the client.
- Dev only: `/login?instance=` hits a Vite module-resolution error; use `/login.html?instance=`. Production builds are unaffected.
- The build is Vite (`vite.config.js`). `build.ts`, `buildnode.js`, `dev-server.js`, `.swcrc` and the Node server in `src/index.ts`, `src/stats.ts`, `src/utils.ts` belong to the pre-Vite pipeline and nothing runs them (see `docs/local/machloket-client-tasks.md`, P0 item 3).
- `.husky/` and `.forgejo/` are upstream leftovers: husky is not installed as a git hook here, and GitHub does not run Forgejo workflows.

## Workflow

- Commit straight to `main` (no PRs; Deck env doc, "Where PRs Are Used").
- the owner doesn't read diffs. A fresh-context review agent checks every change before it's committed.
- Every behaviour fix lands red-first: write the test, watch it fail on the assertion the fix is about, then fix.
- The task list lives in `docs/local/machloket-client-tasks.md` (git-excluded via `.git/info/exclude`). Evidence for each item is in `~/Projects/spacebar-server/docs/local/client-survey-2026-09-27.md`.
