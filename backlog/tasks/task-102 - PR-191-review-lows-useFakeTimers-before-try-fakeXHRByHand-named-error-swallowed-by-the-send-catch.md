---
id: TASK-102
title: >-
  PR #191 review lows: useFakeTimers before try; fakeXHRByHand named error
  swallowed by the send catch
status: To Do
assignee: []
created_date: '2026-11-24T01:29:00Z'
labels:
  - tests
  - rate-limit
dependencies: []
priority: low
ordinal: 33920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the claude-review on PR #191 (TASK-101). (1) src/webpage/utils/rateLimitWindows.test.ts (the "pump whose line a reset emptied" test): vi.useFakeTimers runs before the try, so if it threw the unhandledrejection listener would stay attached; move it inside the try or add the listener after it. (2) src/webpage/messageSend.test.ts fakeXHRByHand: the named payload_json error is swallowed by the attachment path in src/webpage/channel.ts (try { res.send(formData) } catch { fail(); }), so a missing payload_json surfaces as a failed send, not the message; record the error where the attachment specs assert (e.g. a fakeErrors array checked empty), or say in the doc comment that it surfaces only as a failed send. The TASK-101 PR/commit wording ("names a missing payload_json") overstated this. Anchors as of 54a5faa2; re-grep.
<!-- SECTION:DESCRIPTION:END -->
