---
id: TASK-127
title: isAccountStored counts a logged-out stored entry as stored
status: To Do
assignee: []
created_date: '2026-11-24T16:01:00Z'
labels:
  - accounts
dependencies: []
priority: low
ordinal: 58920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
isAccountStored (src/webpage/utils/storage/settingOverlay.ts) answers by uid presence in the stored userinfos. A stored entry for the same uid that is marked loggedin:false (a signed-out account kept in the list), re-authenticated on a full store, reads as stored, so the boot skips the 'signed in for this session only' Dialog although the new sign-in is session-only. Check what loggedin:false entries hold, then red-first. Found in TASK-6's review.
<!-- SECTION:DESCRIPTION:END -->
