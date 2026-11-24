---
id: TASK-18
title: 'U-up3: self-hosted invite links + drop third-party trust'
status: Done
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-24T17:02:00Z'
labels:
  - branding
  - parity
dependencies: []
priority: high
ordinal: 50
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-ruled 11-10, unbuilt. Invites render as `<client origin>/invite/<code>?instance=...` instead of the explorer short links; remove the third-party bot-catalog fetch + help link; drop the explorer domain from the trusted-host defaults; inviteUtils stops rewriting upstream hosts (settles the R8 trust-drop ruling).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-11-24: shipped in PR #207 (merged 20b9f928), CI gate + claude-review green.
<!-- SECTION:NOTES:END -->
