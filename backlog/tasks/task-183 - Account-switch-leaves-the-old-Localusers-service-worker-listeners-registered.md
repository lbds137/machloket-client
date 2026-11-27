---
id: TASK-183
title: Account switch leaves the old Localuser's service-worker listeners registered
status: Done
assignee: []
created_date: '2026-11-26T16:56:00Z'
updated_date: '2026-11-27T01:18:00Z'
labels:
  - auth
  - leak
dependencies: []
priority: medium
ordinal: 114920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-170. The Localuser constructor registers SW.captureEvent('refreshURL', ...) (src/webpage/localuser.ts constructor); Localuser.unload never calls SW.uncaptureEvent. After each showAccountSwitcher switch, the swapped-out Localuser stays reachable from SW.eventListeners (a leak per switch), and a refreshURL message from the service worker is answered by every instance constructed on the page, each posting its own refreshedUrl (a swapped-out account's refreshURL runs too). (traceSub registers a 'trace' listener the same way but has no caller today: git grep 'traceSub()' finds only its definition.) Fix: keep the listener reference on the instance and uncapture it in unload (or when swapped); test that a switch leaves exactly one refreshURL listener.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From the PR #230 review: once uncapture exists, switch the apiFetch.test.ts afterEach (TASK-156 describe) from editing SW.eventListeners directly to the new uncapture path.

Shipped in PR #235 (merged 2dcbbb9f; both commits landed individually, content diff vs head empty). Implemented by the agy gemini worker (worktree-agent-183) from the grounded spec; its print-timeout killed the final red-first run but the edits were complete — the driver ran the red-first itself: switch test red `expected 2 to be 1` (apiFetch.test.ts:2605), dead-account test red on `firstRefresh` called (apiFetch.test.ts:2628), unload pin green at HEAD; full file 81/81 after the fix; then gate+e2e via deck-job mc-t183-gate2: unit 2527/2527 (281 files), e2e 197 passed (the first gate run caught a prettier drift, one fixup commit). claude-review PASS (9cbe9e8f) with 2 lows, carried to the next test-touching PR (role Next): captureEvent identity asserts should filter by event name (tests 1 and 3); afterEach's `?.` on the now-required uncaptureRefreshURL becomes a plain call. Worker-launch lesson: the implement scaffold's gate.sh home-path line is lint-REFUSED by agy-worker (role trap 52) — worker specs carry vitest+tsc gates, gate.sh stays driver-side; Deck routed the scaffold/lint fix to DP-B as TASK-401.
<!-- SECTION:NOTES:END -->
