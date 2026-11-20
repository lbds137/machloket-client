---
id: TASK-45
title: 'searchMap: member-search nonces on socket drop'
status: To Do
assignee: []
created_date: '2026-11-19T22:20:00Z'
updated_date: '2026-11-20T02:38:00Z'
labels:
  - gateway
  - deferred
dependencies: []
priority: low
ordinal: 660
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Member-search nonces (searchMap, localuser gotChunk) are not settled on a socket drop the way member lookups now are; a resume's replay usually answers it, a full reconnect leaves the search promise pending. Trigger: next member-search touch.
<!-- SECTION:DESCRIPTION:END -->
