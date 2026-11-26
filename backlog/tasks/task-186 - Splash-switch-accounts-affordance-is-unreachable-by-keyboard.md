---
id: TASK-186
title: Splash switch-accounts affordance is unreachable by keyboard
status: In Progress
assignee:
  - machloket-client
created_date: '2026-11-26T21:35:00Z'
updated_date: '2026-11-26T22:08:00Z'
labels:
  - accessibility
dependencies: []
priority: low
ordinal: 117920
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The loading screen's account switcher entry (#switchaccounts in app.html, wired in index.ts:85) is a click-only <p>: no tabindex, no role, no keydown. Keyboard and screen-reader users cannot switch accounts from the splash at all - Tab skips it and Enter does nothing. Found while shipping TASK-174 (the Retry button's focus/announcement, PR #233): the Retry button is now focusable and announced, but the affordance beside it is not. Fix shape: role="button" + tabindex="0" + Enter/Space keydown (or a real <button>), matching the Retry button's pattern; assert focusability in the mock tier.
<!-- SECTION:DESCRIPTION:END -->
