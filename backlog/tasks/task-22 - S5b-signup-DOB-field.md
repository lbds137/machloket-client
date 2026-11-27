---
id: TASK-22
title: 'S5b: signup DOB field'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-27T18:42:00Z'
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

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-11-27T18:42:00Z

---

Probe note 11-27 (TASK-139 close): stock spacebar.chat also answers /policies/instance/config with register_dateOfBirth_required:true (no minimum key) - the route is shared, the fork adds minimum:13. Mock config route should answer stock-shaped unless the spec tests the fork minimum.

---
<!-- COMMENTS:END -->
