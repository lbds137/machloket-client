---
id: TASK-168
title: >-
  PR #219 review lows: invalidateAccount non-object record comment;
  unreadable-store test
status: To Do
assignee: []
created_date: '2026-11-26T00:42:00Z'
labels:
  - auth
  - test
dependencies: []
priority: low
ordinal: 99920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
claude-review on PR #219 (TASK-155). (1) utils.ts ~925-929: a stored users[uid] that exists but is not an object is now left untouched (it was overwritten with a logged-out record); intended, other readers skip non-objects, but say so in the comment. (2) No test pins the unreadable/corrupt-store branch of invalidateAccount (persist now false instead of a refused save): corrupt userinfos + confirmed-dead 401 -> live instance flips, nothing throws, store untouched.
<!-- SECTION:DESCRIPTION:END -->
