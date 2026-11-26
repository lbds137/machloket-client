---
id: TASK-175
title: userinfos is a whole-document read-modify-write across tabs
status: To Do
assignee: []
created_date: '2026-11-26T02:59:00Z'
labels:
  - storage
  - auth
dependencies: []
priority: low
ordinal: 106920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by council review of TASK-163 (2026-11-25). adduser, clearPendingLogout, saveAccounts and the other userinfos writers read the whole document, change it and write it back; the cookie slot lock serializes writers on one hostname only. Two tabs writing for different accounts or hostnames at once can each overwrite the other's change (an account added in one tab lost, or a cleared pending logout restored). Related, not the same: the 11-10 note on stale-overlay write clobbering (pre-store tracker, S2 design unit). Fix candidates: one short store-wide Web Lock around every userinfos read-modify-write, or per-account keys. Trigger: the S2 storage design unit, or a report of a lost account or a resurrected pending logout.
<!-- SECTION:DESCRIPTION:END -->
