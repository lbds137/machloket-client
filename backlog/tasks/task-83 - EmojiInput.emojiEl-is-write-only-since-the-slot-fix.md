---
id: TASK-83
title: EmojiInput.emojiEl is write-only since the slot fix
status: To Do
assignee: []
created_date: '2026-11-23T00:32:00Z'
labels:
  - media
dependencies: []
priority: low
ordinal: 14920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #174 claude-review (round 3, low). After TASK-78 round 2, EmojiInput (src/webpage/settings.ts, around :1201) swaps its display through emojiSlot, and emojiEl is only ever written. Leaving it invites someone to reuse it on a node the image fallback may have detached, which is the round-2 bug. Do: remove the field. Grep the tests first: welcomeEditor.test.ts may read it.
<!-- SECTION:DESCRIPTION:END -->
