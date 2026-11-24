---
id: TASK-134
title: 'Source offer follow-ups (PR #209 review lows)'
status: To Do
assignee: []
created_date: '2026-11-24T18:05:00Z'
labels:
  - licence
  - docs
dependencies: []
priority: low
ordinal: 65920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #209 (TASK-19) claude-review PASS with six lows, filed rather than iterated (Lila 11-24: finish the highs, then park). 1) Default source link 404s for an unpushed commit, a fork that forgot MACHLOKET_SOURCE_URL, or a dirty tree: README note that the link is valid once the commit is pushed. 2) vite.config.js calls getBuildVersion() twice (__BUILD_REVISION__ and sourceUrl): compute once. 3) translations/qqq.json: document sourceOffer ($1 is a link; keep the AGPL/Fermo credit). 4) Rename public/features/fermo-settings-design.webp (+ index.html ref). 5) custom-badges.json is fetched every load to return {}: drop the file and lookup, or keep for a future Machloket badge set (Lila's product call). 6) Record the PNG to WebP conversion command for the landing image in the ux-shots spec comment. Re-grep the named files at unit time.
<!-- SECTION:DESCRIPTION:END -->
