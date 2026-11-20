---
id: TASK-44
title: 'Verify: stickers/gifs/polls void-on-refusal'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - probe-first
  - owner-input
dependencies: []
ordinal: 650
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Correction 11-18: main sends + DM-open have failed-bubble handling, but no later ship record was found for the stickers/gifs/polls void-on-refusal half — status UNRESOLVED. Verify on the next touch of those send paths; if still void, the fix shape (an inline failed-send notice carrying the server's message) is user-visible -> owner pick before building. Related LOW: an empty channel's refused first send leaves topid = the fake id (self-heals on the next real message).
<!-- SECTION:DESCRIPTION:END -->
