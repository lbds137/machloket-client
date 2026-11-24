---
id: TASK-6
title: 'U-fs5: session-only account survival across in-app navigations'
status: Done
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-24T17:56:00Z'
labels:
  - store
dependencies: []
priority: high
ordinal: 40
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the #139 review lows (deferred to U-fs5):

(1) A full in-app navigation (switcher add-account to /login; switcher logout of the current user, `src/webpage/switcher.ts:82`) silently drops a session-only account — re-carry the accounts overlay (carryAccountsAcrossNavigation) before the app's own full navigations; the ruled copy promises "for this session"/"after a reload".
(2) `src/webpage/index.ts:107` notifies on any hand-off even when the booted account IS stored — gate on the booted uid being absent from the stored list.
(3) proxySave drop path where updateLocalQuietly is also refused leaves the overlay without the large value while memory has it — keep the overlay in step (or comment); characterise first.
(4) Comment: why HANDOFF_KEY is a literal in inviteAcceptSessionOnly.test.ts.

Test: add-account from a session-only account keeps it (red-first).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24: shipped in PR #208 (merged 3ed183a1); review lows filed as TASK-133; CodeQL #70/#71 (test fixtures) dismissed per Lila's AUQ ruling 11-24.
<!-- SECTION:NOTES:END -->
