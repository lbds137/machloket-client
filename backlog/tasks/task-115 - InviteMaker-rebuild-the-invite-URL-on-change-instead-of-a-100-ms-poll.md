---
id: TASK-115
title: 'InviteMaker: rebuild the invite URL on change instead of a 100 ms poll'
status: To Do
assignee: []
created_date: '2026-11-24T13:07:00Z'
labels:
  - bots
  - tests
dependencies: []
priority: low
ordinal: 46920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review on PR #201 (TASK-109), three lows with one root. src/webpage/bot.ts Bot.InviteMaker polls every 100 ms to rebuild one URL string. (1) A generator made off-page and never shown keeps ticking until GC, which can be never because the PermissionToggle refs (role.ts permToggle/permBtns) hold its container. (2) The '!shownIn' (WeakRef emptied) branch can't be reached since PR #197's strongly held placeholder: dead defensive code. (3) The poll itself is wasteful. Fix: rebuild the URL from the PermissionToggle change hook (Options.changed or the toggle's own onchange); this drops the timer and the lifecycle problems in (1) and (2). Keep bot.test.ts's interval tests honest: replace them with tests of the URL updating on a toggle, not delete them silently. Re-grep anchors at unit time.
<!-- SECTION:DESCRIPTION:END -->
