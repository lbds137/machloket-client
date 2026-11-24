---
id: TASK-116
title: 'streamedLists.test ban-pager tidy: PR #202 review lows'
status: To Do
assignee: []
created_date: '2026-11-24T13:36:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 47920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review PASS on PR #202 (TASK-105), all low, in src/webpage/streamedLists.test.ts: (1) the expect(next.disabled).toBe(false) lines after await frames(() => !next.disabled) repeat what frames now asserts (three pager tests). (2) unban(root, menu, username) takes menu separately though every caller passes root.menu; type root as ReturnType<typeof banList> and read root.menu. (3) 'unbanning a ban on page 2 of 100 stays on page 2' doesn't assert page 2 holds 50 rows after next.click() and before the unban, so a partial draw would show as a confusing 49-row mismatch. (4) PagerOpts.guild is unknown, so fixture typos pass. Re-grep anchors at unit time.
<!-- SECTION:DESCRIPTION:END -->
