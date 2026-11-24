---
id: TASK-103
title: 'Ban list: an unban that empties the last page leaves an empty page shown'
status: Done
assignee: []
created_date: '2026-11-24T01:38:00Z'
updated_date: '2026-11-24T04:25:00Z'
labels:
  - bans
  - ui
dependencies: []
priority: low
ordinal: 34920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-98 review (makeBanList in src/webpage/guild.ts). The unban handler filters the ban out of bansArr and calls loadPage(currentPage). If that ban was the only row on the last page (e.g. 51 bans, on page 2, unban u51), the pane redraws page 2 with no rows: Next disabled, Back enabled, no hint. Discord-parity behaviour would step back to the previous page (or clamp currentPage to the last non-empty page) when the current page empties and the stream has ended. Behaviour existed before TASK-98 (old loadPage did the same). Red-first: needs the unban path testable, which today needs the Settings pane rendered (banMenu.addSubOptions) - see the TASK-98 PR for why its unban test was skipped. Anchors as of the TASK-98 branch; re-grep.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #199 (merged 2026-11-24 04:22Z). Sonnet (cross-family) and claude-review both passed. Their lows (the test's Options-internals lookup and abort-based wait, the untested zero-ban and 100-ban edge cases) were added to TASK-105.
<!-- SECTION:NOTES:END -->
