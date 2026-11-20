---
id: TASK-61
title: checkURLs / instance-URL rider pack
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - deferred
dependencies: []
ordinal: 840
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) The Yes/No pings have no timeout — a server that never answers keeps the dialog up + the promise pending (the utils.ts TODO race); fold in the dead null-throw guards nearby.
(b) getApiUrlsV2 swallows checkURLs' null — propagate the rejection.
(c) The policies-URL builder using pathname.includes("api") glues on bare-origin well-knowns and false-positives ("/rapid") — use appendApi.
(d) The V2 well-known fetch runs on untrimmed input (typed trailing slash -> //); V1 trims.
(e) sameApi could URL-normalise (uppercase host / explicit default port).
(f) Unconditional "/" mirror hazards at the ping URLs (utils.ts ~723, localuser.ts ~6078, login.ts:31).
(g) checkInstance and the picker await instancefetch, which waits on I18n.done — a failed translation load hangs the picker. Trigger: the I18n error-path fix.
<!-- SECTION:DESCRIPTION:END -->
