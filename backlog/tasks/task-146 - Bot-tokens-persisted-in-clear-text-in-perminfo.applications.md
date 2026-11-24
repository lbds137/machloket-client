---
id: TASK-146
title: Bot tokens persisted in clear text in perminfo.applications
status: To Do
assignee: []
created_date: '2026-11-24T21:14:00Z'
updated_date: '2026-11-24T21:26:00Z'
labels:
  - security-hardening
  - design
dependencies: []
priority: low
ordinal: 77920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in the TASK-136 design survey. Bot tokens are kept in perminfo.applications in localStorage (src/webpage/localuser.ts ~5366 load, ~5601 save). decision-9 keeps bots on header tokens, but whether the client must persist them at all (vs. showing once and holding in memory) is a separate decision; same clear-text storage class as TASK-136. Disposition needs a ruling on the product trade-off (bot test UI convenience vs. storage).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Correction 2026-11-24 (TASK-136 review): localuser.ts ~5366 sets the in-memory botTokens map only; persistence is ~5600 (writes perminfo.applications only when an entry already exists) and loading is ~5370.
<!-- SECTION:NOTES:END -->
