---
id: TASK-104
title: >-
  service.test.ts diagnostic fallbacks have no committed tests (PR #192 review
  low)
status: Done
assignee: []
created_date: '2026-11-24T01:44:00Z'
updated_date: '2026-11-24T03:53:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 35920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review on PR #192 (TASK-100). The three fallback paths in src/webpage/service.test.ts test helpers - until() appending "; diagnose failed: ..." when the probe throws, portDiagnosis() ignoring a stale pong posted before the ping (messages.slice(before)), and the marker read keeping the ping/message fields when it throws ("marker: read failed: ...") - were positive-controlled only in scratch runs (recorded in commit 077f244c). A refactor could regress them silently. Pin each with a small test; reviewer sketch for the first: until("x", () => false, 0, async () => { throw new Error("boom") }) rejects with /timed out.*diagnose failed: Error: boom/. The helpers may need exporting or a local test inside service.test.ts. Anchors as of 077f244c; re-grep.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #198 (merged 2026-11-24 03:51Z). Review lows: (1) the pong-after-ping test reads the real marker cache, which an earlier test's worker may still write to. Ruled out: no test asserts on marker: there, and one that adds such an assertion must seed the cache (the review says so in PR #198). (2) the missing 'messages before ping: none' assertion was filed as TASK-111. (3) the stale-pong test costs 2 s of real time. Accepted: portDiagnosis hard-codes 2000 ms, and making that injectable only to save 2 s of suite time is not worth it.
<!-- SECTION:NOTES:END -->
