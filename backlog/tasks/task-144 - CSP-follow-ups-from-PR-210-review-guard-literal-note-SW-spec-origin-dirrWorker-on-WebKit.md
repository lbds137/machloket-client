---
id: TASK-144
title: >-
  CSP follow-ups from PR #210 review: guard literal note, SW spec origin,
  dirrWorker on WebKit
status: To Do
assignee: []
created_date: '2026-11-24T20:45:00Z'
labels:
  - csp
  - e2e
dependencies: []
priority: low
ordinal: 75920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From claude-review on PR #210 (all low): (1) vite.config.js evalCallFiles and importingPolicyChunks fail on eval(/Function(/import inside string or comment literals in emitted JS: add one comment line saying rephrase the literal, never loosen the regex. (2) e2e/csp.spec.ts service-worker spec hard-codes /^http:\/\/localhost:4173\/$/: derive the expected scope from baseURL. (3) The bundled dirrWorker (src/webpage/utils/utils.ts, initWorker) is WebKit-only and runs in no tier: add runtime coverage if a WebKit project lands.
<!-- SECTION:DESCRIPTION:END -->
