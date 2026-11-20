---
id: TASK-64
title: Forum/search rider pack
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
labels:
  - deferred
dependencies: []
ordinal: 870
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
(a) Forum showError's 5s timers overlap (a 2nd error within 5s is wiped early).
(b) The group refusal shows only "HTTP <status>", not the server's reason (sendErrorText is channel.ts-private).
(c) Bare .json() sites at channel.ts 472/943/1551/3221/3435/3811 (1611/2757/3922 guarded).
(d) fetchForum (channel.ts ~2326-2350) is unguarded x3 (fetch rejection, non-JSON 2xx, null/missing threads) and its callers are fire-and-forget — a failure never renders the forum view.
(e) A refused forum search is console-only and Next is disabled at <=25 posts — no retry affordance until a filter change/reopen.
(f) A search refusal wipes the panel; forumSearch uncaught.
(g) Sticker tags: a free-text tag from another client renders as text (a typeof guard is cheap, guild.ts ~1098).
(h) Application-owned emoji: the server answers {type:"APPLICATION", application:{...}} with no guild and the tap card says "private" — show the app as the source.
Trigger: next forum/search/emoji touch.
<!-- SECTION:DESCRIPTION:END -->
