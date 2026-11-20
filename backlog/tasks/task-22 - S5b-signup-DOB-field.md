---
id: TASK-22
title: 'S5b: signup DOB field'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - settings
dependencies: []
priority: medium
ordinal: 410
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The fork's `GET /policies/instance/config` exposes register_dateOfBirth_required (true) + register_dateOfBirth_minimum (13) (live, probed); DOB saved at register when required. Wire errors on the date_of_birth field: BASE_TYPE_REQUIRED / DATE_OF_BIRTH_INVALID / DATE_OF_BIRTH_UNDERAGE (localized per Accept-Language; exactly-13 passes). The e2e mock grows the config route when this lands. Small, unscheduled; probe the endpoint before pinning.
<!-- SECTION:DESCRIPTION:END -->
