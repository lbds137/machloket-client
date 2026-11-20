---
id: TASK-17
title: 'U-up2: voice batch (CodeQL #41 + timer sweep)'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:37:00Z'
labels:
  - voice-media
dependencies: []
priority: high
ordinal: 10
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CodeQL #41 (accepted, high): `src/webpage/voice.ts:498` `.replace("\r","")` should be replaceAll — cosmetic CR strip on the server's own voice data; fix opportunistically here.

Also folds in:
- Voice factory leak on rebuild (orphaned Voice: mic + RTCPeerConnection, no UI handle) — leave current voice in unload() and before replacing voiceFactory (supersedes the G9 drain entry).
- Voice.packet should guard ws === socket (a late op 6 from a closed socket can re-arm the heartbeat after leave).

Trigger: next voice unit.
<!-- SECTION:DESCRIPTION:END -->
