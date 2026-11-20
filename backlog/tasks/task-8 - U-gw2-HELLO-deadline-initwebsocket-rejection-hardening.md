---
id: TASK-8
title: 'U-gw2: HELLO deadline + initwebsocket rejection hardening'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:37:00Z'
labels:
  - gateway
dependencies: []
priority: medium
ordinal: 80
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From gateway review 2:

- G2 MED: no deadline between socket creation and HELLO — the watchdog arms only at op 10, so a never-arriving HELLO strands the splash (localuser.ts:634 comment overstates). Fix: one-shot HELLO deadline (~30s) -> socketClosed(ws, 4000), cleared at op 10.
- G6 LOW/MED: initwebsocket rejections unhandled (localuser.ts:778/:847 .then without catch); new WebSocket throws on a malformed gateway/resume URL; a bare DecompressionStream identifier throws where absent — try/catch to the socketClosed path, typeof guard.
<!-- SECTION:DESCRIPTION:END -->
