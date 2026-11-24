---
id: TASK-130
title: Back/forward and session-only accounts
status: To Do
assignee: []
created_date: '2026-11-24T16:14:00Z'
labels:
  - accounts
dependencies: []
priority: low
ordinal: 61920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in TASK-6's review (Gemini), from reading the code, not run. Two sides of one design question, when the app's boot uses up the hand-off (consumeAccountHandoff, src/webpage/index.ts): (a) a page restored from the back/forward cache doesn't run loadAccountHandoff again, so after a reload on another page dropped the hand-off, the restored page still holds the dropped accounts in memory and its next pageNav.go writes them back; (b) Back from /channels to a page that isn't cached finds no hand-off (the boot removed it) and drops a live session-only account on what is a navigation. A pageshow handler that drops the overlay when the hand-off is gone fixes (a) but makes (b) worse (it can't tell a reload's drop from the boot's consume). Fix shape: the boot keeps the hand-off (or a generation marker tells a reload from a consume), then e2e for both, red-first.
<!-- SECTION:DESCRIPTION:END -->
