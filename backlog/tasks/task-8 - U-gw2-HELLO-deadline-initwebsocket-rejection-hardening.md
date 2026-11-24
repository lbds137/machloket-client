---
id: TASK-8
title: 'U-gw2: HELLO deadline + initwebsocket rejection hardening'
status: Done
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-24T15:41:00Z'
labels:
  - gateway
dependencies: []
priority: high
ordinal: 80
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From gateway review 2:

- G2 MED: no deadline between socket creation and HELLO — the watchdog arms only at op 10, so a never-arriving HELLO strands the splash (localuser.ts:634 comment overstates). Fix: one-shot HELLO deadline (~30s) -> socketClosed(ws, 4000), cleared at op 10.
- G6 LOW/MED: initwebsocket rejections unhandled (localuser.ts:778/:847 .then without catch); new WebSocket throws on a malformed gateway/resume URL; a bare DecompressionStream identifier throws where absent — try/catch to the socketClosed path, typeof guard.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Promoted to high 2026-11-24 (Lila via Deck: finish highs, then park): verified on main, the gateway watchdog arms only at op 10 (src/webpage/localuser.ts:1511), so a HELLO that never arrives leaves the splash up forever with no recovery.

2026-11-24 plan: one-shot HELLO deadline (~30 s) after new WebSocket -> socketClosed(ws, 4000) (guard ws === this.ws), cleared at op 10 and in stopHeartbeat (localuser.ts ~1538). G6: .catch on initwebsocket callers (index.ts:114, localuser.ts:254/812/877), try around new WebSocket, typeof DecompressionStream guard. Tests in gatewayWatchdog.test.ts with FakeWebSocket (connect() helper; ws.closed === 4000).

Shipped in PR #206 (merged 2026-11-24, b037e487). CodeQL alert #69 (re-indented twin of #4) dismissed per Lila 11-24 before automerge.
<!-- SECTION:NOTES:END -->
