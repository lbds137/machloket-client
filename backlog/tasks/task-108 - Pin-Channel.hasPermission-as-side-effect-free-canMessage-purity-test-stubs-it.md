---
id: TASK-108
title: >-
  Pin Channel.hasPermission as side-effect-free (canMessage purity test stubs
  it)
status: To Do
assignee: []
created_date: '2026-11-24T03:29:00Z'
labels:
  - tests
dependencies: []
priority: low
ordinal: 39920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
guildAdmin.test.ts's canMessage purity test (PR #196) stubs hasPermission to () => true, so a request or state write inside the real permission path would pass unnoticed. Add a test that runs canMessage over a real hasPermission (a guild with roles and overwrites) under the same fetch spy and asserts no request. Positive control: a scratch fetch inside hasPermission must fail it. From the PR #196 review (low).
<!-- SECTION:DESCRIPTION:END -->
