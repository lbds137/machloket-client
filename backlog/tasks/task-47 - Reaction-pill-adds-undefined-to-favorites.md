---
id: TASK-47
title: Reaction pill adds undefined to favorites
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - deferred
dependencies: []
priority: low
ordinal: 680
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Clicking an existing unicode reaction pill adds undefined to reaction favorites: message.ts ~1901 builds an Emoji without .emoji, then addReactEmoji(emoji.id || emoji.emoji) ~:512. The quick-react recents path can pass a custom emoji's bare id as a string, which never matches a reaction and PUTs /reactions/<id>. Upstream. Trigger: next reaction-UI touch.
<!-- SECTION:DESCRIPTION:END -->
