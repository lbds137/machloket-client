---
id: TASK-99
title: >-
  ownerCode.test bot-owns-guilds 403 test: 'Tried to make a sub menu when the
  options weren't rendered' under full-suite load
status: To Do
assignee: []
created_date: '2026-11-23T21:07:00Z'
labels:
  - test-flake
dependencies: []
priority: medium
ordinal: 30920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First sighting 2026-11-23 in the TASK-71 branch gate (test run started 16:01:56 EST) (1 failed / 2287 passed; the branch only touches service.test.ts). Throw at src/webpage/settings.ts:1811 (Options.genTop), via Options.addSubForm <- Localuser.manageApplication (localuser.ts:5357) <- ownerCode.test.ts:476, which passes new Dialog("").options un-rendered. Isolated rerun: 11/11 green. Hypothesis (unverified): genTop depends on render state that the manageApp fixture reaches only by timing. Next: read Options.genTop's rendered check and manageApp's setup; red-first by forcing the un-rendered state. Failure screenshot was under src/webpage/.vitest/attachments/failure-screenshots/ownerCode.test.ts/ (git-ignored, regenerated).
<!-- SECTION:DESCRIPTION:END -->
