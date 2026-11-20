---
id: TASK-63
title: createObjectURL revocation audit
status: To Do
assignee: []
created_date: '2026-11-19T22:21:00Z'
labels:
  - deferred
dependencies: []
ordinal: 860
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Other createObjectURL sites never revoked, unaudited: channel.ts ~4082, file.ts ~252, media.ts ~411/~501 (the utils.ts staticImgMap case was settled by its own ruling — revoking there would break live images). Trigger: LOW batch.
<!-- SECTION:DESCRIPTION:END -->
