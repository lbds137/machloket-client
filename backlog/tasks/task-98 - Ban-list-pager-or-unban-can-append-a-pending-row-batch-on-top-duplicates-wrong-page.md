---
id: TASK-98
title: >-
  Ban list pager or unban can append a pending row batch on top (duplicates /
  wrong page)
status: Done
assignee: []
created_date: '2026-11-23T20:28:00Z'
updated_date: '2026-11-24T02:07:00Z'
labels:
  - ui
dependencies: []
priority: low
ordinal: 29920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-95's review (council gpt-sol, 2026-11-23). makeBanList (src/webpage/guild.ts) buffers streamed rows in bansArr2 for a zero-delay timer, but loadPage (pager Next/Back, and the re-render after an unban) rebuilds banDiv from bansArr without clearing or invalidating that buffer. A batch still pending when loadPage runs is then appended on top: duplicates after an unban (loadPage already drew those bans), or page-1 rows appended under page 2 if Next is pressed before the flush (Next enables on the 51st item, which can arrive in the same chunk as rows still buffered). The window is one task, so this is rare, but the end state is wrong, not just a flicker. The shared `onpage` counter means two things (rows queued while streaming vs rows rendered by loadPage), which is the root. Fix shape: bansArr + currentPage as the only source of truth; the stream schedules a render of the current slice (cancelled/forced by loadPage), and Next's state derives from bansArr.length. Red-first with deterministic timing: hold the timer (vi fake timers or a stubbed setTimeout), unban or press Next, release, then assert exact rows. Trigger: next touch of makeBanList, or sooner if a walk sees a doubled ban row.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shipped in PR #193 (85315f9e): makeBanList draws from bansArr + currentPage only (one drawn counter, one coalesced pending draw that loadPage cancels; loadPage sets Next/Back). Review lows (test robustness/duplication/no-op awaits) filed as TASK-105; empty page after unban = TASK-103.
<!-- SECTION:FINAL_SUMMARY:END -->
