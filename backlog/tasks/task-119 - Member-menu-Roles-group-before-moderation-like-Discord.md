---
id: TASK-119
title: 'Member menu: Roles group before moderation, like Discord'
status: To Do
assignee: []
created_date: '2026-11-24T14:02:00Z'
labels:
  - parity
dependencies: []
priority: medium
ordinal: 50920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discord glance 2026-11-24 (Claude in Chrome, Lila's web client, right-click on a member-list row; one member, a bot, in one guild, with her permissions there; Timeout/Ban rows did not appear): Discord's member context menu is Profile, Mention, Message, Add Note | Change Nickname, Apps, Ignore, Block (red) | Roles | Open in Mod View, Kick (red) | Copy User ID. Ours (pinned by e2e/member-menu.spec.ts 'the member menu orders moderation, then roles, then copy-id') puts moderation BEFORE roles. Fix: move the roles group above the moderation group, update the e2e pin (red-first: change the pin's expected order, watch it fail, then reorder). Re-check where Timeout and Ban sit in Discord with a member Lila can time out/ban before landing (a human member on a guild she moderates). Also noted: Discord's Block row is red.
<!-- SECTION:DESCRIPTION:END -->
