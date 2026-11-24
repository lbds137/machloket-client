---
id: TASK-111
title: >-
  service.test: assert 'messages before ping: none' in the pong-after-ping
  portDiagnosis test
status: To Do
assignee: []
created_date: '2026-11-24T03:53:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 42920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #198's 'pong after its ping' test asserts 'messages after: pong' but not 'messages before ping: none', so only the stale-pong test pins how seen/after split, and only in one direction. Add the assertion. Positive control: making the helper report every message as before-ping must fail it. From the PR #198 review (low).
<!-- SECTION:DESCRIPTION:END -->
