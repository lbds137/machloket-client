---
id: TASK-67
title: Gateway drain riders (G7/G11/E1)
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
labels:
  - gateway
  - deferred
dependencies: []
ordinal: 900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
- G7: the wsCodesRetry whitelist lacks op 9 + 4004/4006 (the server's session-remove close gives up instead of re-identifying; 4004 shows generic text) — accidentally right today (those paths revoke the token); fix = a terminal blacklist. The resume test asserts the client's own close code, not the event's.
- G11: RESUMED resets errorBackoff (guard it when RESUMED gets its guard — benign today); the G11a never-settles window extends to drops-while-gottenReady-processes; ephemeral flows must be judged on the invoker's websocket view, never channel REST (by design).
- Stuck-reconnect: the splash sits on "reconnecting" with no retry scheduled — schedule the retry independently of the lookup (or time-box it) + catch. Trigger: next close-handler touch or a stuck-reconnect report.
<!-- SECTION:DESCRIPTION:END -->
