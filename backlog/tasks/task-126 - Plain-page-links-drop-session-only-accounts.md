---
id: TASK-126
title: Plain page links drop session-only accounts
status: To Do
assignee: []
created_date: '2026-11-24T16:01:00Z'
labels:
  - accounts
dependencies: []
priority: low
ordinal: 57920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Session-only accounts reach the next page only through pageNav.go's hand-off (src/webpage/utils/netUtils.ts). Plain same-tab anchors skip it: the login screen's reset-password link (src/webpage/login.ts:14-18), the links in index.html and 404.html, and badge and attachment links without target=_blank (src/webpage/user.ts:1786, 2174; src/webpage/file.ts:307). Following one signs a session-only account out. Fix shape: route same-origin anchor clicks through pageNav (or carry on pagehide), red-first per link class. Found in TASK-6's review.
<!-- SECTION:DESCRIPTION:END -->
