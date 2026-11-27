---
id: TASK-187
title: >-
  membersView marker-skip delivers an adjacent marker to navigation (no chained
  backstop)
status: To Do
assignee: []
created_date: '2026-11-27T03:58:00Z'
labels:
  - tech-debt
dependencies: []
references:
  - src/webpage/utils/membersView.ts
  - src/webpage/utils/searchView.test.ts
priority: low
ordinal: 118920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
consumeMembersPop (src/webpage/utils/membersView.ts:56-65) is single-shot: a pop landing on the marker sets skipLanding and calls history.back() once. If THAT pop lands on a second adjacent marker, skipLanding consumes it and returns false — the marker state reaches channel navigation (goToState with {machloketMembersView:true}). The searchView twin has a chained backstop for exactly this worst case (src/webpage/utils/searchView.ts:189-201, test 'two adjacent markers anyway (the backstop's worst case) are skipped in one back press'); membersView does not.

Found by the review-round overshoot assert on PR #236 (membersView.test.ts, 'pushes the channel entry, then closes the view over it'): it failed deterministically because the preceding test left its view open + marker on the shared test history stack, manufacturing adjacent markers. The test pollution is fixed on the PR; this task is the product-side gap the assert exposed.

Reachability in the app (traced 11-26): same-view adjacency needs two membersView pushes without an intervening close; setMembersOpen(true) is guarded by !membersOpen() and a UI close with a buried marker does not traverse, so no in-app path currently stacks two membersView markers. Cross-view adjacency (members marker under a search marker) is caught by consumeSearchPop's own guard. So this is defensive parity, not a live bug — promote when the open path changes, a same-view stack becomes reachable, or handoff semantics change.
<!-- SECTION:DESCRIPTION:END -->
