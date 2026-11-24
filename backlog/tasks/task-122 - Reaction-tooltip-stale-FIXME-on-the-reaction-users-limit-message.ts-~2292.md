---
id: TASK-122
title: 'Reaction tooltip: stale FIXME on the reaction-users limit (message.ts ~2292)'
status: To Do
assignee: []
created_date: '2026-11-24T14:32:00Z'
labels:
  - cleanup
dependencies: []
priority: low
ordinal: 53920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From machloket-server (11-24, its TASK-165 closed obsolete in PR #268): the fork's server honors the reaction-users limit (src/api/routes/channels/#channel_id/messages/#message_id/reactions.ts:159-160: default 25, outside 1..100 returns 400; take: limit at :175), so fetchReactionUsers(..., 3) already returns at most 3 users. The FIXME at src/webpage/message.ts:2292 ('the api ignores limit and just sends everything') is stale on the fork. Decide at next touch: the client also talks to non-fork Spacebar instances, which may still ignore limit, so the users.splice(0, 3) under it may be worth keeping as a guard. Either rewrite the comment to say that (a server that ignores limit) or drop both lines if older instances are out of scope. Re-grep anchors at unit time.
<!-- SECTION:DESCRIPTION:END -->
