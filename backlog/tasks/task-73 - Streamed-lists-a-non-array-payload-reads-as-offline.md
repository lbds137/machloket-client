---
id: TASK-73
title: >-
  streamList hardening: non-array payload, typed decoder, onItem errors, refusal
  headers
status: Done
assignee: []
created_date: '2026-11-22T16:41:00Z'
updated_date: '2026-11-22T17:41:00Z'
labels:
  - u-api
dependencies: []
priority: medium
ordinal: 4920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the PR #169 council review (TASK-72). streamList (src/webpage/guild.ts) casts ProgessiveDecodeJSON's result to an array decoder; a 200 whose body is a JSON object or scalar fails on arr.getNext and the list shows requestFailed("offline"), which misnames a protocol error. Check the top-level decoder type and show a distinct line (needs an I18n string). Trigger: next touch of the invite/ban lists, or any report of an "offline" list on a live link.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PR #169 claude-review (merged 43411287), folded in: (1) DEFECT: a scalar top-level payload (null/number/string) makes streamList's finally run arr.prog.close() on a non-container -> TypeError inside .then = unhandled rejection, and the load is never aborted. Fix: close non-container loads inside ProgessiveDecodeJSON (or guard), red-first. (2) replace the as-unknown-as decoder shape cast with an exported type from progessiveLoad.ts. (3) keep onItem throws out of the 'offline' catch (or document). (4) the rebuilt refusal Response keeps only status: pass statusText + headers through (a 429 Retry-After reader would see none), or comment why not. Ruled out: (5) ban failure line after the pager matches the invite pane.

Shipped PR #170 -> f7b182d1 (gate 2179 + e2e 173; council OpenAI clean; claude-review PASS). Widened in-unit: unparseable 200 bodies (HTML) also read listUnreadable. Review Lows (1)-(3) -> TASK-74. (4) ruled out on merit: an onItem throw rejecting streamList (unhandled in the panes' void loadArr) is the stated contract; callbacks only push. Gemini cross-family pass still owed.
<!-- SECTION:NOTES:END -->
