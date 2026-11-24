---
id: TASK-137
title: >-
  Joint CI gate: real-server e2e tier in CI, mock responses validated against
  server schemas
status: To Do
assignee: []
created_date: '2026-11-24T18:24:00Z'
labels:
  - ci
  - contract
  - server-joint
dependencies: []
priority: medium
ordinal: 68920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: Deck's client+server coupling survey for Lila, 2026-11-24. Today e2e-real/ runs only locally against the server harness, and the mock tier is typed against the client's own jsontypes, so client/server drift passes CI. Cheaper first step: validate the mock instance's responses against the server's schemas.json with ajv in the mock tier. Full step: run e2e-real/ in CI against the server harness (the server repo is private; needs a CI-safe way to boot it). Joint with Machloket Server.
<!-- SECTION:DESCRIPTION:END -->
