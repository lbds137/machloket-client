---
id: TASK-185
title: Gateway fast-retry branch keeps the first socket's uptime measure
status: To Do
assignee: []
created_date: '2026-11-26T17:57:00Z'
labels:
  - gateway
dependencies: []
priority: low
ordinal: 116920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the TASK-173 review (Gemini, finding 2). socketClosed fast-retry branch (src/webpage/localuser.ts, the errorBackoff === 0 branch) does not clear connectionSucceed, and op 11 only sets it when it is 0, so a chain of fast-retry sockets is measured from the FIRST socket ACK. Effects (code-reading, not runtime-confirmed): the backoff path can judge a chain as a good connection; after TASK-173, a socket flapping with READY for 20 s, then a 4004, re-arms the automatic 4004 retry once. Not fixed in TASK-173 because clearing it there changes the reconnect delay after a failed fast retry (0.2 s today, 5.8 s if measured per socket): that is a user-visible tradeoff. Fix shape: measure per socket and carry the previous close verdict for the one fast-retry attempt.
<!-- SECTION:DESCRIPTION:END -->
