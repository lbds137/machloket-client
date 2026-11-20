---
id: TASK-50
title: og:image absolute URL
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:42:00Z'
labels:
  - branding
  - owner-input
  - deferred
dependencies: []
priority: low
ordinal: 710
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
og:image is relative (speculative; the deploy host is unknown at build time). Fix = a build-time absolute URL for the hosted origin. Needs the Railway hosting conversation first (owner call).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner ruling 2026-11-19 (ask tool): server and client will both be hosted on Railway; timing is the owner's call. Fix og:image against the Railway origin when that hosting unit opens.
<!-- SECTION:NOTES:END -->
