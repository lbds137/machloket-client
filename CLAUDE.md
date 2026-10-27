# Machloket

Machloket (מחלוקת, "discord") is a Discord-like web client for [Spacebar](https://spacebar.chat) instances — a fork of **Fermo** (AGPL-3.0, vanilla TypeScript + Vite), forked at `371e601`.

## Hard constraints

- **Never contribute upstream.** Fermo's README asks that no AI-assisted work touch its repo: no PRs, issues or contact with its maintainer from here. `upstream` (`https://git.sovrahi.com/oh64/Fermo.git`) is fetch-only; its push URL is disabled on purpose. Agent fetch tools get a Cloudflare 403 there; plain `git`/`curl` work.
- **Licence:** keep the AGPL notices (`LICENSE`, author credits).
- **Donor code** may come from Fuzzy (AGPL-3.0; the look-and-feel reference), Flicker (GPL-3.0), Lucide (ISC; the vendored icon set — `src/webpage/public/icons/LUCIDE-LICENSE`), Fluxer (AGPL-3.0, fluxerapp/fluxer) and Stoat (Lila 10-25: reference with attribution; check Stoat's licence file at first donor use). Refactor donor code freely.
- **Parity bar:** someone switching from Discord should have "minimal headache": same layout, interaction patterns and shortcuts. Decompiling Discord's client is out.
- **Server-side questions** (Web Push, instance config, gateway, interaction routes) belong to the server project that hosts the instance, not to this client.

## Commands

Node 24 (LTS), npm (the repo ships `package-lock.json`; don't switch it to pnpm).

| What                               | Command                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| Install                            | `npm ci`                                                    |
| Type check                         | `npm run check`                                             |
| Tests (headless Chromium)          | `npm test`                                                  |
| e2e type check                     | `npm run check:e2e`                                         |
| e2e (builds, then Playwright)      | `npm run test:e2e`                                          |
| Production build → `dist/webpage/` | `npm run build`                                             |
| Dev server                         | `npx vite --port 8080` (add `--host 0.0.0.0` for other devices) |

- **The gate before every commit:** `npm run check && npm test && npm run build`. Every unit also runs the e2e tier (`npm run check:e2e && npm run test:e2e`) — it builds first, so it never green-lights code the tests did not see. Its harness (e2e/fixtures.ts + e2e/mock/) fails any spec whose page makes an off-origin request or a same-origin request the mock doesn't answer; `PW_REUSE_SERVER=1` opts into reusing a running preview server. `E2E_SHOTS=1` opts into the documentation-capture spec (`e2e/ux-shots.spec.ts`, shot PNGs into git-ignored `docs/local/`) when running Playwright directly; the tier always skips it.
- Tests are Vitest in browser mode (`vite.config.js` → `test`). The app's modules import each other in cycles that only evaluate correctly under native browser ESM; Vitest's default module runner (tried with happy-dom) fails at import. A test imports `./localuser` before anything else, in the entry's order (see `src/webpage/instancePicker.test.ts`). `src/webpage/test/setup.ts` answers instance discovery in memory (`addInstance`, `acceptLogins`); other same-origin requests reach the Vitest server. First run on a new machine: `npx playwright install chromium`.
- The instance list is `src/webpage/public/instances.json`. A git-ignored `docs/local/instances.json`, when present, is merged in at build and dev-serve time with its entries first (they become the default pick; `utils/instanceOverlay.ts`). `{hostname}` in a `url` is replaced with the host serving the client.
- Dev only: `/login?instance=` hits a Vite module-resolution error; use `/login.html?instance=`. Production builds are unaffected.
- The build is Vite (`vite.config.js`), the only pipeline; the pre-Vite one (`build.ts`, the Node server, the Dockerfile) was removed.

## Workflow

- Every change lands by PR, never straight to `main`: branch → push → PR (open it as the owner, not as a draft — `automerge` only fires for those). The `claude-review` job reviews it, and the `automerge` job merges once the review passes and all checks are green. Never merge by hand — a hand merge skips the review gate — except a PR that changes `.github/workflows/claude-code-review.yml`: it gets no review (the action skips itself), so the owner merges it by hand after reading it. (Owner ruling 2026-10-27.)
- Every change gets a fresh-context review agent before it's committed. A reviewer that runs the gate does it in a scratch copy of the tree (on disk, `node_modules` symlinked), never in the working tree.
- Every behaviour fix lands red-first: write the test, watch it fail on the assertion the fix is about, then fix.
- Machine-local state (task tracker, evidence, session notes) lives in `docs/local/`, which is git-ignored.
