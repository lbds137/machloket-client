Run this repo's full test suite once on this VM and return the complete output through git. This is a test run, so change nothing in the repo's code: the only files you add are under `@RESULTS@/`.

The suite is the commit gate chain plus the e2e tier, run in two Bash calls (each has its own 10-minute cap and its own rc file; the suite passes only when BOTH are green):

1. After Step 0, run the commit gate with the `suite as <user>:` command from the setup output, but with its command replaced by the first four parts only, in one Bash call (timeout 600000 ms):

   `npm run format:check && npm run check && npm test && npm run build`, its output sent to `/tmp/suite.out 2>&1` and its exit code to `/tmp/suite.rc` (`echo rc=$? > /tmp/suite.rc`).

1b. Then the e2e tier (`npm run check:e2e && npm run test:e2e`; it builds first, so it never green-lights code the tests did not see), one Bash call (timeout 600000 ms), output to `/tmp/suite-e2e.out 2>&1` and exit code to `/tmp/suite-e2e.rc` (`echo rc=$? > /tmp/suite-e2e.rc`).

   If there is no `suite as <user>:` line, run `. /tmp/cloud-env.sh && npm ci --no-audit --no-fund && npm run format:check && npm run check && npm run build` as root and say so in the report; the browser tiers (`npm test`, `npm run test:e2e`) cannot run as root (Chromium's sandbox), so leave them out and say that too.

   If a call times out, first run `pgrep -a -f 'npm|vitest|playwright'`: if that call is still alive, do not start another; poll its rc file (`/tmp/suite.rc` or `/tmp/suite-e2e.rc`) every 2 minutes until it appears. Only if nothing is running and the rc file is absent, `rm -f` that call's output and rc files and rerun the same command under `nohup ... &` with `timeout 1500` in front of the chain, then poll its rc file every 2 minutes.

2. Full logs of the failing parts: each of `format:check`, `check`, `test`, `build`, `check:e2e`, `test:e2e` counts as one part. For each part whose rc is non-zero, run that part alone as the same user and in the same way as its step (the same `runuser ... bash -c 'cd ... && . <env file> && ...'`), with `mkdir -p /tmp/probes && chmod 777 /tmp/probes` done once, and `timeout 600 npm run <part> > /tmp/probes/<part>.out 2>&1; echo "rc=$?" >> /tmp/probes/<part>.out` in place of the chain. Run them one at a time. With no failing parts, skip this step.

3. `mkdir -p @RESULTS@ && git rev-parse HEAD > @RESULTS@/head.txt && cp /tmp/cloud-setup.out /tmp/suite.out /tmp/suite.rc /tmp/suite-e2e.out /tmp/suite-e2e.rc @RESULTS@/`, then `[ -d /tmp/probes ] && cp -r /tmp/probes @RESULTS@/`, then save `nproc; free -g; uname -a` to `@RESULTS@/host.txt`. `head.txt` must be written before any commit: it is the tree the suite ran on. (If a suite rc file is missing because a tier never ran, say so in the report instead of copying a stale one.)

4. `git add @RESULTS@ && git commit -m "cloud-test: suite output"`, then push the branch. The push target is the `cloud-test/*` scratch branch you were started on (never `main`; this repo's ruleset refuses direct pushes to `main`). Commit identity and push authentication are the claude CLI's own on this VM — the dispatcher's prompt carries the Delivery section with the same rules (commit on the started branch, push to origin, open no PR); they are proven working by deck-platform's r1-r8 runs. The pushed files are the deliverable: the driver reads them from git, not from your report.

5. In the report, give rc for each tier, the user each tier ran as, vitest's summary line (`Test Files  X passed` / `Tests  X passed`), the tails of `npm run check` and `npm run build` (last 5 lines), Playwright's summary line, every MISSING / install FAILED / npm ci FAILED / test user FAILED line from setup, and every skipped-screenshot annotation line verbatim. Do not analyse the failures.
