---
id: TASK-189
title: 'Cloud setup follow-ups from PR #237 review rounds 2-3 (lows)'
status: To Do
assignee: []
created_date: '2026-11-27T08:28:00Z'
labels:
  - tooling
  - cloud
  - deferred
dependencies: []
priority: medium
type: task
ordinal: 120920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seven lows from PR #237 (merged bc93da00) review rounds 2-3, all PASS-verdict, batched for one follow-up PR. First two have teeth:

1. .git/config credential hygiene: the VM copy keeps the session clone config (credential helper, possible http.extraheader token) and the test user then owns it while npm ci runs third-party install scripts. Reviewer: hygiene rather than a leak path, but fix first in the batch: git -C "$trepo" remote remove origin and unset credential.* / http.*.extraheader before the chown (setup.sh ref-hygiene block).
2. Owner-independent git: cp -a keeps the source uid, so if a provisioner ever runs a non-root session, git would refuse the copy (dubious ownership). The round-2 rc checks fail loudly today; make it work instead: cp -r --preserve=mode,timestamps,links (root owns the copy until the later chown) or -c safe.directory on those calls.
3. Dirty-tree check beside the test tree print: HEAD equality does not cover uncommitted edits (cp -a copies those too); add git -C "$trepo" status --porcelain reported or fatal next to test tree.
4. step0.md: add the test tree FAILED instruction (that path exits 0 with no suite line; today the agent would fall through to the root fallback and drop browser tiers).
5. setup.sh probe list: chromium/flock/script MISSING lines never apply (playwright installs its own chromium) - trim or mark informational so step0 reports are not noise every run.
6. suite.md step 3: [ -d /tmp/probes ] && cp returns 1 with no probes and an && -chained agent would skip host.txt; use if.
7. A shell probe for setup.sh branching (hostname guard, root vs non-root, branch cleanup + HEAD check with a fake repo) - the class that bit in rounds 1-2 (origin/main detach, chown-before-git order) is exactly what a probe pins.

Carried line: docs/local/carried-lows.md #237. Related deck-platform note: DP landed setup may share the chown-before-git ordering (flagged in the PR body for their side).
<!-- SECTION:DESCRIPTION:END -->
