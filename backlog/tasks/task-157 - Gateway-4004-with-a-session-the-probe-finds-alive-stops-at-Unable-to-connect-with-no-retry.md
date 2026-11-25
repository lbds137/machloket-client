---
id: TASK-157
title: >-
  Gateway 4004 with a session the probe finds alive stops at Unable to connect
  with no retry
status: To Do
assignee: []
created_date: '2026-11-25T19:25:00Z'
updated_date: '2026-11-25T19:28:00Z'
labels:
  - bug
  - gateway
dependencies: []
priority: low
ordinal: 88920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review on PR #215. After TASK-147, a gateway close 4004 probes <api>/users/@me; when the probe says the session is alive (REST accepts the token the gateway refused: a server bug or a token-rotation race), the close path ends at "Unable to connect" with no retry and no explanation, as before TASK-147. Options: one more IDENTIFY attempt after a live probe, or a manual Retry on the loading screen. User-visible: pick the shape with Lila before building.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Lila ruling 2026-11-25 (AskUserQuestion): after a live probe, retry IDENTIFY automatically once; if the gateway closes 4004 again, show a Retry button on the loading screen instead of the dead end.
<!-- SECTION:NOTES:END -->
