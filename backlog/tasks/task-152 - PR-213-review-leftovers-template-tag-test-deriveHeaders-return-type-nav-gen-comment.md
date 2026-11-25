---
id: TASK-152
title: >-
  PR #213 review leftovers: template tag test, deriveHeaders return type,
  nav-gen comment
status: To Do
assignee: []
created_date: '2026-11-25T00:14:00Z'
labels:
  - auth
  - tests
dependencies: []
priority: low
ordinal: 83920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
claude-review on PR #213 (merged) left three low items: (1) no test pins that templatePage.ts GET carries the account tag (buildAccountHeaders(joinable[0], {json:false})); add it to the "raw-token pages tagged" case in src/webpage/utils/accountHeaders.test.ts or templatePage.test.ts. (2) deriveHeaders<T> returns T though extra adds undeclared keys; widen to T & Record<string,string> and drop the test casts. (3) unauthorizedNavGen in src/webpage/utils/apiFetch.ts is bumped only by resetUnauthorizedNavForTests; add a one-line comment that it exists for test isolation.
<!-- SECTION:DESCRIPTION:END -->
