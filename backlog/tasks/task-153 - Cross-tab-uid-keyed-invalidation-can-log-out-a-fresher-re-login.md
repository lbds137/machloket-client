---
id: TASK-153
title: 'Cross-tab: uid-keyed invalidation can log out a fresher re-login'
status: To Do
assignee: []
created_date: '2026-11-25T00:14:00Z'
labels:
  - auth
dependencies: []
priority: medium
ordinal: 84920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From PR #213 review (item 4, pre-existing): invalidateAccount(uid) marks every stored entry for the uid logged out. Tab A holding an old token probes dead and logs out the fresh session tab B stored after a re-login. Before #213 tryUpdateLocal could already overwrite the stored entry, so not a regression. Fix shape: compare the stored credential with the probed one before invalidating the stored entry. Trigger: do with TASK-149/150 (cookie units touch the same path).
<!-- SECTION:DESCRIPTION:END -->
