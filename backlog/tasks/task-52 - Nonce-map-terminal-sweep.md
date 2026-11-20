---
id: TASK-52
title: Nonce-map terminal sweep
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
labels:
  - gateway
  - server-bounded
  - deferred
dependencies: []
ordinal: 730
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
interactionNonces/commandChannels/commandNonceLabels/interNonceMap keep entries for nonces that never echo or never finish (capped 200, oldest-first, since 0d78d68f). A terminal-event sweep needs the server's event order pinned first (the M2 double-delivery investigation, same event stream).
<!-- SECTION:DESCRIPTION:END -->
