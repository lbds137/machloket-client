---
id: TASK-85
title: AST-based raw-fetch guard (successor to the TASK-77 text guard)
status: To Do
assignee: []
created_date: '2026-11-23T01:53:00Z'
labels:
  - u-api
dependencies: []
priority: low
ordinal: 16920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deferred from the TASK-77 council review (gpt-sol, 2026-11-22). src/webpage/rawFetch.test.ts is a line-by-line text guard: it misses fetch passed as a value (.then(fetch)), aliases, bracket access (globalThis["fetch"]), window?.fetch, and non-prettier spacing (window. fetch, fetch (u)); it also scans comments and strings (hence the dead block-comment leaves in ALLOWED). An AST check (TypeScript compiler API in a Node-side test, or ESLint no-restricted-globals/no-restricted-properties; ESLint is disabled here since e07e9a99) would see references, not spellings. Trigger: a raw fetch reaches main in one of those missed forms, or ESLint returns to the repo.
<!-- SECTION:DESCRIPTION:END -->
