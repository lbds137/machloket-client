---
id: TASK-41
title: Voice live-test pack
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - voice-media
  - probe-first
  - deferred
dependencies: []
priority: low
ordinal: 620
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Needs a live voice session (the family's trigger):
- startWS continuation after the url/ws-open awaits is not tied to its join: a leave then rejoin before it resumes lets the stale continuation proceed — join generation counter checked after each await.
- V-3 AudioContext leak; V-4 uncertain.
- L11 Go Live/streams for DM call: keys never resolve (streamCreate handles only guild:), live/steamTokens never cleaned, streamCreate throws a bare "oops" unhandled; check whether the server even sends STREAM_CREATE for DMs.
- L15 audio node graph: giveMicTrack never disconnects the old MediaStreamSource; makeMicOuts creates a new streamDest without disconnecting the old (verify device switches don't cut audio).
The voice fixes are unit-tested only — no live voice-server run yet.
<!-- SECTION:DESCRIPTION:END -->
