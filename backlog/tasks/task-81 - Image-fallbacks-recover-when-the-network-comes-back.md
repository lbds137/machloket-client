---
id: TASK-81
title: 'Image fallbacks: recover when the network comes back'
status: To Do
assignee: []
created_date: '2026-11-22T23:45:00Z'
labels:
  - media
dependencies: []
priority: low
ordinal: 12920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #174 claude-review (round 1, low). The TASK-78 fallbacks (emoji -> :name:, sticker -> named box, icons -> initials, banners removed) are permanent per element. 'error' also fires offline or on a 5xx, so an image that failed during an outage stays as text until the message re-renders. Deliberate for now. Promote if users see lasting :name: text after a reconnect. Possible fix: on window 'online', re-try the fallen-back elements (keep the original src on the fallback element).
<!-- SECTION:DESCRIPTION:END -->
