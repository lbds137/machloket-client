---
id: TASK-138
title: getmessage uses the direct GET messages/:id route
status: To Do
assignee: []
created_date: '2026-11-24T18:24:00Z'
labels:
  - api
  - cleanup
dependencies: []
priority: low
ordinal: 69920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: Deck's client+server coupling survey for Lila, 2026-11-24. channel.ts ~1728 getmessage fetches a single message indirectly; switch to GET /channels/:id/messages/:message_id. Red-first: a test pinning the request made. Re-grep at unit time.
<!-- SECTION:DESCRIPTION:END -->
